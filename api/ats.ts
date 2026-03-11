import type { VercelRequest, VercelResponse } from '@vercel/node';

export default async function handler(req: VercelRequest, res: VercelResponse) {

// 1. BLINDAGEM DE ORIGEM (Impede que outros sites usem sua API)
    const origin = req.headers.origin || req.headers.referer || '';

    // Libera se estiver rodando localmente (localhost) ou no seu domínio do Vercel
    const isLocal = origin.includes('localhost');
    const isMyVercel = origin.includes('https://leitor-telemetria.vercel.app/');

    // Se a requisição veio de um site desconhecido, bloqueia na hora!
    if (origin && !isLocal && !isMyVercel) {
        return res.status(403).json({ error: "Acesso negado. Origem não autorizada." });
    }

    // Bloqueia requisições que não sejam POST ou GET
    if (req.method !== 'POST' && req.method !== 'GET') {
        return res.status(405).json({ error: "Método não permitido" });
    }

    // Bloqueia qualquer requisição que não seja GET ou POST
    if (req.method !== 'POST' && req.method !== 'GET') {
        return res.status(405).json({ error: "Método não permitido" });
    }

    try {
        // Agora o TypeScript sabe o que é o process.env!
        const apiToken = process.env.ATS_API_TOKEN;

        if (!apiToken) {
            throw new Error("Token não configurado no servidor.");
        }

        const queryBombas = `query($apiToken: String!) { atsAssets(apiToken: $apiToken) { result { name } } }`;
        const queryCartoes = `query($apiToken: String!) { authenticationCards(apiToken: $apiToken) { result { id number externalIdentifier asset { name } } } }`;

        const [resBombas, resCartoes] = await Promise.all([
            fetch('https://api.layrz.com/ats/graphql', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ query: queryBombas, variables: { apiToken } })
            }),
            fetch('https://api.layrz.com/ats/graphql', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ query: queryCartoes, variables: { apiToken } })
            })
        ]);

        if (!resBombas.ok || !resCartoes.ok) throw new Error("Falha na API da Layrz");

        const dataBombas = await resBombas.json();
        const dataCartoes = await resCartoes.json();

        // Devolvemos os dados em formato JSON com status 200 (OK)
        return res.status(200).json({
            bombas: dataBombas.data?.atsAssets?.result || [],
            cartoes: dataCartoes.data?.authenticationCards?.result || []
        });

    } catch (error) {
        console.error(error);
        return res.status(500).json({ error: "Erro interno do servidor." });
    }
}