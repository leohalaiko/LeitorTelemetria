import { useState } from 'react';
import Papa from 'papaparse';
import * as XLSX from 'xlsx';
import { toast, Toaster } from 'sonner';
import { ArrowLeft, Download, FileSpreadsheet, Settings, X } from 'lucide-react';

// Importação das funções
import { processLogFile, processWlnFile, formatForExcel } from './utils/processors';

// Importe seus componentes
import { ModeSelector } from './components/ModeSelector';
import { FileUpload } from './components/FileUpload';

function App() {
    const [currentMode, setCurrentMode] = useState<string | null>(null);
    const [processedData, setProcessedData] = useState<any[]>([]);
    const [isProcessing, setIsProcessing] = useState(false);
    const [startIdInput, setStartIdInput] = useState<string>("");

    // ESTADOS PARA O MODAL
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [pumpName, setPumpName] = useState("");

    // --- 1. FUNÇÃO DE CRIAÇÃO DA PLANILHA (Blindada) ---
    const createWorkbook = (nomeBombaBruto: string) => {
        const cleanData = formatForExcel(processedData);
        if (cleanData.length === 0) return null;

        // PROTEÇÃO 1: Remove espaços extras do começo/fim
        const nomeBomba = nomeBombaBruto.trim();

        // Cabeçalhos (Linha 1)
        const headers = [
            "Bomba", "Hora Inicio", "Hora Fim", "Medidor",
            "Encerrante inicial m³", "Encerrante Inicial", "Encerrante Final",
            "Litros", "Placa", "0,00001", "ID", "Frentista", "Odometro"
        ];

        const sheetData: any[][] = [];
        sheetData.push(headers);

        // --- LINHA 2: CONFIGURAÇÃO INICIAL ---
        const primeiroRegistro = cleanData[0];
        const medidorInicialDia = primeiroRegistro.medidorInicial;
        const m3Inicial = medidorInicialDia / 100000;

        // PROTEÇÃO 2: Preencher o nome da bomba também na linha 2 (Setup)
        // Alguns sistemas exigem que a coluna A esteja preenchida em todas as linhas
        const row2 = [
            nomeBomba,          // A (Preenchido para garantir vínculo)
            "",                 // B
            "",                 // C
            medidorInicialDia,  // D
            m3Inicial,          // E
            "", "", "", "", "", "", "", ""
        ];
        sheetData.push(row2);

        // --- LINHAS 3+: DADOS ---
        cleanData.forEach((item) => {
            const row = [
                nomeBomba,          // A
                item.horaInicio,    // B
                item.horaFim,       // C
                item.medidorFinal,  // D
                "",                 // E
                null, null, null,   // F, G, H (Fórmulas)
                item.placa,         // I
                "",                 // J
                item.id,            // K
                item.frentista,     // L
                item.odometro       // M
            ];
            sheetData.push(row);
        });

        const ws = XLSX.utils.aoa_to_sheet(sheetData);

        // INJEÇÃO DE FÓRMULAS
        for (let i = 2; i < sheetData.length; i++) {
            const linhaExcel = i + 1;
            const linhaAnterior = linhaExcel - 1;

            const cellF = XLSX.utils.encode_cell({ r: i, c: 5 });
            ws[cellF] = { t: 'n', f: `D${linhaAnterior}`, v: 0 };

            const cellG = XLSX.utils.encode_cell({ r: i, c: 6 });
            ws[cellG] = { t: 'n', f: `D${linhaExcel}`, v: 0 };

            const cellH = XLSX.utils.encode_cell({ r: i, c: 7 });
            ws[cellH] = { t: 'n', f: `(G${linhaExcel}-F${linhaExcel})*0.01`, v: 0 };
        }

        ws['!cols'] = [
            { wch: 30 }, { wch: 12 }, { wch: 12 }, { wch: 15 },
            { wch: 20 }, { wch: 15 }, { wch: 15 }, { wch: 10 },
            { wch: 12 }, { wch: 10 }, { wch: 15 }, { wch: 20 }, { wch: 10 }
        ];

        // --- PROTEÇÃO 3: NOME DA ABA (DATA) ---
        // Garante que SEMPRE haverá uma data no nome da aba
        let nomeDaAba = "";

        if (processedData.length > 0 && processedData[0].originalTimestamp) {
            const dataObj = new Date(processedData[0].originalTimestamp);
            const dia = String(dataObj.getDate()).padStart(2, '0');
            const mes = String(dataObj.getMonth() + 1).padStart(2, '0');
            const ano = dataObj.getFullYear();
            nomeDaAba = `${dia}.${mes}.${ano}`;
        } else {
            // Fallback: Se não achar data no arquivo, usa HOJE
            const dataHoje = new Date();
            const dia = String(dataHoje.getDate()).padStart(2, '0');
            const mes = String(dataHoje.getMonth() + 1).padStart(2, '0');
            const ano = dataHoje.getFullYear();
            nomeDaAba = `${dia}.${mes}.${ano}`;
        }

        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, nomeDaAba);

        return wb;
    };

    const handleDownloadClick = () => {
        if (processedData.length === 0) return;
        setPumpName("");
        setIsModalOpen(true);
    };

    const confirmDownload = () => {
        if (!pumpName.trim()) {
            toast.error("Por favor, digite o nome da bomba.");
            return;
        }

        const wb = createWorkbook(pumpName);
        if (!wb) return;

        // Gera nome do arquivo
        let nomeArquivo = "Relatorio.xlsx";
        if (processedData.length > 0 && processedData[0].originalTimestamp) {
            const dataObj = new Date(processedData[0].originalTimestamp);
            const dia = String(dataObj.getDate()).padStart(2, '0');
            const mes = String(dataObj.getMonth() + 1).padStart(2, '0');
            const ano = dataObj.getFullYear();
            nomeArquivo = `Planilha insercao de abastecimento_S10_${dia}.${mes}.${ano}.xlsx`;
        } else {
            // Fallback nome do arquivo
            const d = new Date();
            nomeArquivo = `Planilha insercao de abastecimento_S10_${d.getDate()}.${d.getMonth()+1}.${d.getFullYear()}.xlsx`;
        }

        XLSX.writeFile(wb, nomeArquivo);
        toast.success(`Planilha gerada para: ${pumpName}`);
        setIsModalOpen(false);
    };

    const handleFileSelect = async (file: File) => {
        setIsProcessing(true);
        setProcessedData([]);

        if (currentMode === 'travado' && !startIdInput) {
            toast.error("Por favor, digite o Último ID Válido antes de enviar o arquivo.");
            setIsProcessing(false);
            return;
        }

        try {
            const isWlnFile = file.name.toLowerCase().endsWith('.wln');

            if (currentMode === 'wln' || isWlnFile) {
                if (currentMode !== 'wln') {
                    toast.info("Arquivo .WLN detectado! Usando leitor compatível.");
                }

                const data = await processWlnFile(file);

                if (data.length > 0) {
                    if (currentMode === 'normal') {
                        const cleanData = processLogFile(data, 'normal');
                        if (cleanData.length > 0) {
                            setProcessedData(cleanData);
                            toast.success(`Abastecimentos extraídos: ${cleanData.length}`);
                        } else {
                            setProcessedData(data);
                            toast.warning("Atenção: Não foram encontrados dados de bomba (upar4/upar6).");
                        }
                    } else {
                        setProcessedData(data);
                        toast.success(`${data.length} registros carregados.`);
                    }
                } else {
                    toast.warning("Arquivo WLN vazio ou inválido.");
                }
                setIsProcessing(false);
            }
            else {
                Papa.parse(file, {
                    header: true,
                    skipEmptyLines: true,
                    delimiter: ";",
                    transformHeader: (header: string) => header.trim(),
                    complete: (results: any) => {
                        if (!currentMode) return;
                        const cleanData = processLogFile(results.data, currentMode, {
                            startId: Number(startIdInput)
                        });
                        setProcessedData(cleanData);
                        setIsProcessing(false);
                        if (cleanData.length > 0) toast.success(`${cleanData.length} registros.`);
                    },
                    error: (err: any) => {
                        toast.error("Erro ao ler arquivo: " + err.message);
                        setIsProcessing(false);
                    }
                });
            }

        } catch (error) {
            console.error(error);
            toast.error("Erro crítico ao processar.");
            setIsProcessing(false);
        }
    };

    return (
        <div className="min-h-screen bg-gray-50 py-12 px-4 font-sans text-gray-800">
            <Toaster position="top-right" richColors />

            <div className="max-w-5xl mx-auto">
                <div className="text-center mb-10">
                    <h1 className="text-4xl font-extrabold text-gray-900 tracking-tight mb-2">
                        Analisador de Telemetria
                    </h1>
                    <p className="text-gray-500 text-lg">
                        {currentMode
                            ? <span className="inline-flex items-center bg-blue-100 text-blue-800 px-3 py-1 rounded-full text-sm font-medium">
                  Modo: {currentMode.toUpperCase()}
                </span>
                            : 'Selecione o tipo de análise que deseja realizar'}
                    </p>
                </div>

                {!currentMode ? (
                    <ModeSelector onSelectMode={setCurrentMode} />
                ) : (
                    <div className="animate-fade-in-up">
                        <button
                            onClick={() => { setCurrentMode(null); setProcessedData([]); setStartIdInput(""); }}
                            className="mb-6 flex items-center text-gray-500 hover:text-blue-600 transition-colors font-medium"
                        >
                            <ArrowLeft className="w-5 h-5 mr-2" />
                            Voltar para seleção
                        </button>

                        <div className="bg-white rounded-3xl shadow-xl p-8 border border-gray-100 relative">

                            {currentMode === 'travado' && (
                                <div className="mb-8 p-6 bg-purple-50 rounded-2xl border border-purple-100 flex flex-col md:flex-row items-center gap-4">
                                    <div className="p-3 bg-purple-100 rounded-full text-purple-600">
                                        <Settings className="w-6 h-6" />
                                    </div>
                                    <div className="flex-1">
                                        <h3 className="font-bold text-purple-900">Configuração de Sequência</h3>
                                        <p className="text-sm text-purple-700">O sistema vai ignorar o ID travado e gerar novos IDs sequenciais.</p>
                                    </div>
                                    <div className="w-full md:w-48">
                                        <label className="text-xs font-bold text-purple-800 uppercase ml-1">Último ID Válido</label>
                                        <input
                                            type="number"
                                            placeholder="Ex: 1540"
                                            className="w-full mt-1 px-4 py-2 rounded-xl border border-purple-200 focus:border-purple-500 focus:ring-2 focus:ring-purple-200 outline-none font-mono text-lg"
                                            value={startIdInput}
                                            onChange={(e) => setStartIdInput(e.target.value)}
                                        />
                                    </div>
                                </div>
                            )}

                            <FileUpload onFileSelect={handleFileSelect} />

                            {isProcessing && (
                                <div className="mt-8 text-center text-blue-600 animate-pulse">
                                    Processando dados...
                                </div>
                            )}

                            {processedData.length > 0 && (
                                <div className="mt-8 animate-fade-in-up">
                                    <div className="flex items-center justify-between mb-4 bg-green-50 p-4 rounded-xl border border-green-100">
                                        <div className="flex items-center gap-3">
                                            <div className="p-2 bg-green-100 rounded-lg text-green-600">
                                                <FileSpreadsheet className="w-6 h-6" />
                                            </div>
                                            <div>
                                                <p className="font-bold text-green-900">Sucesso!</p>
                                                <p className="text-sm text-green-700">{processedData.length} registros gerados.</p>
                                            </div>
                                        </div>

                                        <button
                                            onClick={handleDownloadClick}
                                            className="bg-green-600 hover:bg-green-700 text-white px-6 py-3 rounded-xl font-bold flex items-center shadow-lg hover:shadow-green-200 transition-all active:scale-95"
                                        >
                                            <Download className="w-5 h-5 mr-2" />
                                            Baixar Excel
                                        </button>
                                    </div>

                                    <div className="overflow-x-auto border border-gray-100 rounded-xl">
                                        <table className="w-full text-sm text-left">
                                            <thead className="bg-gray-50 text-gray-500 font-medium">
                                            <tr>
                                                <th className="px-4 py-3">Data</th>
                                                <th className="px-4 py-3">ID</th>
                                                <th className="px-4 py-3">Vol (L)</th>
                                                <th className="px-4 py-3">Enc. Inicial</th>
                                                <th className="px-4 py-3">Enc. Final</th>
                                            </tr>
                                            </thead>
                                            <tbody>
                                            {processedData.slice(0, 5).map((row, i) => (
                                                <tr key={i} className="border-t border-gray-50 hover:bg-gray-50">
                                                    <td className="px-4 py-3">{row['Data'] || '-'}</td>
                                                    <td className="px-4 py-3">{row['ID Operação'] || row['ID Original (Travado)'] || '-'}</td>
                                                    <td className="px-4 py-3">{row['Volume (L)']}</td>
                                                    <td className="px-4 py-3">{row['Encerrante Inicial']}</td>
                                                    <td className="px-4 py-3">{row['Encerrante Final']}</td>
                                                </tr>
                                            ))}
                                            </tbody>
                                        </table>
                                        <p className="text-xs text-gray-400 p-2 text-center">Mostrando prévia dos primeiros 5 registros</p>
                                    </div>
                                </div>
                            )}

                            {isModalOpen && (
                                <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4 backdrop-blur-sm animate-in fade-in duration-200">
                                    <div className="bg-white rounded-2xl shadow-2xl p-6 w-full max-w-md border border-gray-100">
                                        <div className="flex justify-between items-center mb-4">
                                            <h3 className="text-xl font-bold text-gray-800">Identificar Cliente</h3>
                                            <button
                                                onClick={() => setIsModalOpen(false)}
                                                className="p-1 hover:bg-gray-100 rounded-full text-gray-500 transition-colors"
                                            >
                                                <X className="w-6 h-6" />
                                            </button>
                                        </div>

                                        <p className="text-sm text-gray-500 mb-4">
                                            <strong>Atenção:</strong> O nome deve ser IDÊNTICO ao cadastrado no sistema (respeite espaços e maiúsculas).
                                        </p>

                                        <div className="mb-6">
                                            <label className="block text-sm font-semibold text-gray-700 mb-2">
                                                Nome da Bomba / Base
                                            </label>
                                            <input
                                                type="text"
                                                autoFocus
                                                placeholder="Ex: Bomba 01 - Matriz"
                                                className="w-full px-4 py-3 rounded-xl border border-gray-300 focus:border-blue-500 focus:ring-2 focus:ring-blue-200 outline-none transition-all"
                                                value={pumpName}
                                                onChange={(e) => setPumpName(e.target.value)}
                                                onKeyDown={(e) => e.key === 'Enter' && confirmDownload()}
                                            />
                                        </div>

                                        <div className="flex gap-3">
                                            <button
                                                onClick={() => setIsModalOpen(false)}
                                                className="flex-1 px-4 py-3 rounded-xl font-semibold text-gray-600 hover:bg-gray-100 transition-colors"
                                            >
                                                Cancelar
                                            </button>
                                            <button
                                                onClick={confirmDownload}
                                                className="flex-1 px-4 py-3 rounded-xl font-bold text-white bg-blue-600 hover:bg-blue-700 shadow-lg shadow-blue-200 transition-all active:scale-95 flex justify-center items-center"
                                            >
                                                <Download className="w-5 h-5 mr-2" />
                                                Gerar Arquivo
                                            </button>
                                        </div>
                                    </div>
                                </div>
                            )}

                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}

export default App;