// src/utils/wlnParser.ts

export interface WlnRecord {
    timestamp: number;
    dataIso: string;
    latitude: number;
    longitude: number;
    // Permite campos dinâmicos como 'upar16', 'pwr_ext', etc.
    [key: string]: string | number;
}

export const parseWlnContent = (content: string): WlnRecord[] => {
    const records: WlnRecord[] = [];
    const lines = content.split(/\r?\n/);

    for (const line of lines) {
        const trimmedLine = line.trim();

        // Ignora linhas que não começam com REG
        if (!trimmedLine || !trimmedLine.startsWith("REG;")) {
            continue;
        }

        const parts = trimmedLine.split(';');

        try {
            // O Timestamp costuma ser o índice 1
            const timestampSeconds = parseInt(parts[1]);
            const timestampMs = timestampSeconds * 1000;

            if (isNaN(timestampMs)) continue; // Pula se timestamp for inválido

            const baseRecord: WlnRecord = {
                timestamp: timestampMs,
                dataIso: new Date(timestampMs).toISOString(),
                latitude: parseFloat(parts[2]),
                longitude: parseFloat(parts[3]),
            };

            // "Explosão" de parâmetros (Parse dinâmico) para pegar upar16, upar23, etc.
            parts.forEach((part) => {
                // Divide cada bloco por vírgula
                const subItems = part.split(',');

                subItems.forEach((item) => {
                    if (item.includes(':')) {
                        let [key, val] = item.split(':');

                        if (key && val) {
                            key = key.trim().toLowerCase();
                            val = val.replace(/"/g, '').trim();

                            const numVal = parseFloat(val);

                            if (!isNaN(numVal) && val !== '') {
                                baseRecord[key] = numVal;
                            } else {
                                baseRecord[key] = val;
                            }
                        }
                    }
                });
            });

            records.push(baseRecord);

        } catch (error) {
            console.error("Erro ao processar linha WLN:", trimmedLine, error);
        }
    }

    return records;
};