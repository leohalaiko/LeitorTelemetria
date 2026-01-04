import { useState } from 'react';
import Papa from 'papaparse';
import * as XLSX from 'xlsx';
import { toast, Toaster } from 'sonner';
import { ArrowLeft, Download, FileSpreadsheet, Settings } from 'lucide-react';

// Importe suas funções
import { processLogFile, processWlnFile } from './utils/processors';

// Importe seus componentes
import { ModeSelector } from './components/ModeSelector';
import { FileUpload } from './components/FileUpload';

function App() {
    const [currentMode, setCurrentMode] = useState<string | null>(null);
    const [processedData, setProcessedData] = useState<any[]>([]);
    const [isProcessing, setIsProcessing] = useState(false);
    const [startIdInput, setStartIdInput] = useState<string>("");

    const handleDownload = () => {
        if (processedData.length === 0) return;
        const wb = XLSX.utils.book_new();
        const ws = XLSX.utils.json_to_sheet(processedData);
        XLSX.utils.book_append_sheet(wb, ws, "Relatorio");
        XLSX.writeFile(wb, `Relatorio_${currentMode}_${new Date().toISOString().slice(0, 10)}.xlsx`);
        toast.success("Download iniciado!");
    };

    const handleFileSelect = async (file: File) => {
        setIsProcessing(true);
        setProcessedData([]);

        // 1. Validação Específica para o modo "Travado"
        if (currentMode === 'travado' && !startIdInput) {
            toast.error("Por favor, digite o Último ID Válido antes de enviar o arquivo.");
            setIsProcessing(false);
            return;
        }

        try {
            // === CENÁRIO A: Arquivo WLN (Lógica Nova) ===
            if (currentMode === 'wln') {
                const data = await processWlnFile(file);

                if (data.length > 0) {
                    setProcessedData(data);
                    toast.success(`WLN processado! ${data.length} registros.`);
                } else {
                    toast.warning("Nenhum registro encontrado no arquivo WLN.");
                }
                setIsProcessing(false);
            }

            // === CENÁRIO B: Arquivos CSV/TXT Padrão (Lógica Antiga com PapaParse) ===
            else {
                Papa.parse(file, {
                    header: true,
                    skipEmptyLines: true,
                    transformHeader: (header: string) => header.trim(),
                    complete: (results: any) => {
                        if (!currentMode) return;

                        // Verifica colunas
                        if (results.meta && results.meta.fields && results.meta.fields.length < 2) {
                            console.warn("Atenção: O arquivo parece ter poucas colunas.");
                        }

                        // Chama o processador antigo
                        const cleanData = processLogFile(results.data, currentMode, {
                            startId: Number(startIdInput)
                        });

                        setProcessedData(cleanData);
                        setIsProcessing(false);

                        if (cleanData.length > 0) {
                            toast.success(`${cleanData.length} registros processados!`);
                        } else {
                            toast.warning("Nenhum registro encontrado. Verifique o separador.");
                        }
                    },
                    error: (err: any) => {
                        toast.error("Erro ao ler arquivo: " + err.message);
                        setIsProcessing(false);
                    }
                });
            }

        } catch (error) {
            console.error(error);
            toast.error("Erro crítico ao processar arquivo.");
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

                        <div className="bg-white rounded-3xl shadow-xl p-8 border border-gray-100">

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
                                            onClick={handleDownload}
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
                                                {Object.keys(processedData[0]).map(header => (
                                                    <th key={header} className="px-4 py-3 whitespace-nowrap">{header}</th>
                                                ))}
                                            </tr>
                                            </thead>
                                            <tbody>
                                            {processedData.slice(0, 5).map((row, i) => (
                                                <tr key={i} className="border-t border-gray-50 hover:bg-gray-50">
                                                    {Object.values(row).map((val: any, idx) => (
                                                        <td key={idx} className="px-4 py-3 whitespace-nowrap">{val}</td>
                                                    ))}
                                                </tr>
                                            ))}
                                            </tbody>
                                        </table>
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