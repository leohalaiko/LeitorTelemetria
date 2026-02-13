import { useState } from 'react';
import Papa from 'papaparse';
import * as XLSX from 'xlsx';
import { toast, Toaster } from 'sonner';
import { ArrowLeft, Download, FileSpreadsheet, Settings, X, Fuel, Edit3 } from 'lucide-react';

import { processLogFile, processWlnFile, formatForExcel, parseTankFile, reconciliateData } from './utils/processors';
import { ModeSelector } from './components/ModeSelector';
import { FileUpload } from './components/FileUpload';

function App() {
    const [currentMode, setCurrentMode] = useState<string | null>(null);
    const [processedData, setProcessedData] = useState<any[]>([]);
    const [isProcessing, setIsProcessing] = useState(false);
    const [startIdInput, setStartIdInput] = useState<string>("");

    const [wlnFile, setWlnFile] = useState<File | null>(null);
    const [tankFile, setTankFile] = useState<File | null>(null);

    const [isModalOpen, setIsModalOpen] = useState(false);

    const [pumpName, setPumpName] = useState("");
    const [fileNameClient, setFileNameClient] = useState("");

    // Guarda o arquivo molde
    const [templateFile, setTemplateFile] = useState<File | null>(null);

    const handleRowEdit = (index: number, field: string, value: string) => {
        const newData = [...processedData];
        newData[index] = { ...newData[index], [field]: value };
        setProcessedData(newData);
    };

    const handleDownloadClick = () => {
        if (processedData.length > 0) {
            setPumpName("");
            setFileNameClient("");
            setTemplateFile(null);
            setIsModalOpen(true);
        }
    };

    // --- A MÁGICA DA INJEÇÃO CIRÚRGICA ---
    const confirmDownload = async () => {
        if (!pumpName.trim() || !fileNameClient.trim()) {
            toast.error("Preencha o Nome da Bomba e o Código do Cliente!");
            return;
        }
        if (!templateFile) {
            toast.error("Você precisa enviar a Planilha Molde para gerar o arquivo!");
            return;
        }

        try {
            // 1. Lê o Molde preservando TUDO (Fórmulas, Cores, Dicionários, etc)
            const arrayBuffer = await templateFile.arrayBuffer();
            const wb = XLSX.read(arrayBuffer, { type: 'array', cellStyles: true, cellFormula: true, cellHTML: false });

            const wsName = wb.SheetNames[0];
            const ws = wb.Sheets[wsName];

            const cleanData = formatForExcel(processedData);

            let medidorInicialDia = 0;
            for (const item of cleanData) {
                if (item.medidorInicial > 0) {
                    medidorInicialDia = item.medidorInicial;
                    break;
                }
            }

            // FUNÇÃO CIRÚRGICA: Atualiza apenas uma célula específica sem tocar no resto da linha
            const updateCell = (r: number, c: number, val: any) => {
                if (val === undefined || val === null || val === "") return;

                const cellRef = XLSX.utils.encode_cell({ r, c });
                let cell = ws[cellRef];

                // Se a célula não existe no molde, nós a criamos
                if (!cell) {
                    cell = {};
                    ws[cellRef] = cell;
                }

                // Injeta Número ou Texto
                if (typeof val === 'number' && !isNaN(val)) {
                    cell.t = 'n';
                    cell.v = val;
                    delete cell.w; // Limpa o cache visual para o Excel recalcular
                } else {
                    cell.t = 's';
                    cell.v = String(val).trim();
                    delete cell.w;
                }
            };

            // INJEÇÃO DA LINHA 2 (r=1)
            updateCell(1, 3, medidorInicialDia); // D2: Medidor

            let medidorCorrente = medidorInicialDia;

            const formatTime = (timeStr: string) => {
                if (!timeStr || timeStr === '-') return "";
                const parts = timeStr.split(':');
                if (parts.length >= 2) return `${parts[0]}:${parts[1]}`;
                return timeStr;
            };

            // INJEÇÃO DOS DADOS (A partir da Linha 3 | r=2)
            cleanData.forEach((item, index) => {
                const isConciliado = currentMode === 'transcricao' && item.volumeConciliado !== undefined;

                let medidorCol;

                if (isConciliado) {
                    const encFim = medidorCorrente + Math.round(item.volumeConciliado * 100);
                    medidorCol = encFim;
                    medidorCorrente = encFim;
                } else {
                    medidorCol = item.medidorFinal;
                }

                const R = index + 2; // R=2 é a linha 3 no Excel

                // Injetamos apenas as colunas de dados cruas!
                updateCell(R, 0, pumpName.trim());                 // Coluna A (Bomba)
                updateCell(R, 1, formatTime(item.horaInicio));     // Coluna B (Hora Inicio)
                updateCell(R, 2, formatTime(item.horaFim));        // Coluna C (Hora Fim)
                updateCell(R, 3, medidorCol);                      // Coluna D (Medidor)

                // PULA E, F, G, H (Deixa o Molde calcular)

                updateCell(R, 8, item.placa);                      // Coluna I (Placa)

                // PULA J (1e-05)

                // ID (Coluna K) - Tenta salvar como número puro sem formatação, se falhar salva como texto
                const idVal = Number(item.id);
                updateCell(R, 10, isNaN(idVal) ? item.id : idVal);

                updateCell(R, 11, item.frentista);                 // Coluna L (Frentista)
                updateCell(R, 12, item.odometro);                  // Coluna M (Odometro)
            });

            // Atualiza a "Área Ativa" da planilha para que o Excel saiba que foram adicionadas linhas novas
            const range = XLSX.utils.decode_range(ws['!ref'] || "A1:M1");
            const maxRow = cleanData.length + 1;
            if (maxRow > range.e.r) range.e.r = maxRow;
            if (12 > range.e.c) range.e.c = 12;
            ws['!ref'] = XLSX.utils.encode_range(range);

            const d = processedData[0]?.originalTimestamp ? new Date(processedData[0].originalTimestamp) : new Date();
            const dia = String(d.getDate()).padStart(2,'0');
            const mes = String(d.getMonth()+1).padStart(2,'0');
            const ano = d.getFullYear();

            const clientCode = fileNameClient.trim().replace(/\s+/g, '');
            const nomeArquivo = `Planilha insercao de abastecimento_S10_${clientCode}_${dia}${mes}${ano}.xlsx`;

            // Salva o arquivo preservando toda a infraestrutura do Excel e do Molde
            XLSX.writeFile(wb, nomeArquivo, { compression: true, bookSST: true });

            toast.success(`Planilha gerada com sucesso! Fórmulas preservadas.`);
            setIsModalOpen(false);

        } catch (error: any) {
            console.error(error);
            toast.error("Erro ao processar o arquivo Molde. Verifique se é uma planilha válida.");
        }
    };

    const handleProcessConciliation = async () => {
        if (!wlnFile || !tankFile) {
            toast.error("Por favor, selecione os dois arquivos.");
            return;
        }
        setIsProcessing(true);
        try {
            const wlnRaw = await processWlnFile(wlnFile);
            const tankRaw = await parseTankFile(tankFile);

            if (tankRaw.length === 0) throw new Error("Não foi possível ler dados do arquivo de tanque.");

            const mergedData = reconciliateData(wlnRaw, tankRaw);
            setProcessedData(mergedData);

            if (mergedData.length > 0) {
                toast.success(`Conciliação concluída! Edite as placas se necessário.`);
            } else {
                toast.warning("Nenhum abastecimento encontrado no cruzamento.");
            }
        } catch (error: any) {
            console.error(error);
            toast.error("Erro na conciliação: " + error.message);
        }
        setIsProcessing(false);
    };

    const handleFileSelect = async (file: File) => {
        if (currentMode === 'transcricao') {
            const name = file.name.toLowerCase();
            if (name.endsWith('.wln') || name.endsWith('.txt')) {
                setWlnFile(file);
                toast.info("Arquivo WLN (Placas) carregado!");
            } else if (name.endsWith('.csv') || name.endsWith('.xlsx')) {
                setTankFile(file);
                toast.info("Arquivo de Tanque (Níveis) carregado!");
            } else {
                toast.warning("Formato desconhecido.");
            }
            return;
        }

        setIsProcessing(true);
        setProcessedData([]);

        if (currentMode === 'travado' && !startIdInput) {
            toast.error("ID inicial obrigatório."); setIsProcessing(false); return;
        }

        try {
            const isWlnFile = file.name.toLowerCase().endsWith('.wln');
            if (currentMode === 'wln' || isWlnFile) {
                const data = await processWlnFile(file);
                if (data.length > 0) {
                    const cleanData = processLogFile(data, currentMode || 'normal', { startId: Number(startIdInput) });
                    setProcessedData(cleanData.length > 0 ? cleanData : data);
                    toast.success(`${cleanData.length || data.length} registros. Edite as placas abaixo.`);
                }
            } else {
                Papa.parse(file, {
                    header: true, skipEmptyLines: true, delimiter: ";", transformHeader: h => h.trim(),
                    complete: (res: any) => {
                        const clean = processLogFile(res.data, currentMode || 'normal', { startId: Number(startIdInput) });
                        setProcessedData(clean);
                        toast.success(`${clean.length} registros. Edite as placas abaixo.`);
                    },
                    error: (err: any) => { toast.error("Erro CSV: " + err.message); setIsProcessing(false); }
                });
            }
        } catch (e) { toast.error("Erro ao processar."); }
        setIsProcessing(false);
    };

    return (
        <div className="min-h-screen bg-gray-50 py-12 px-4 font-sans text-gray-800">
            <Toaster position="top-right" richColors />
            <div className="max-w-5xl mx-auto">
                <div className="text-center mb-10">
                    <h1 className="text-4xl font-extrabold text-gray-900 tracking-tight mb-2">Analisador de Telemetria</h1>
                    <p className="text-gray-500 text-lg">
                        {currentMode ? <span className="inline-flex items-center bg-blue-100 text-blue-800 px-3 py-1 rounded-full text-sm font-medium">Modo: {currentMode.toUpperCase()}</span> : 'Selecione o tipo de análise'}
                    </p>
                </div>

                {!currentMode ? (
                    <ModeSelector onSelectMode={setCurrentMode} />
                ) : (
                    <div className="animate-fade-in-up">
                        <button onClick={() => { setCurrentMode(null); setProcessedData([]); setStartIdInput(""); setWlnFile(null); setTankFile(null); }} className="mb-6 flex items-center text-gray-500 hover:text-blue-600 font-medium">
                            <ArrowLeft className="w-5 h-5 mr-2" /> Voltar
                        </button>

                        <div className="bg-white rounded-3xl shadow-xl p-8 border border-gray-100 relative">

                            {currentMode === 'transcricao' ? (
                                <div className="space-y-6">
                                    <div className="p-4 bg-orange-50 border border-orange-200 rounded-xl text-orange-800 text-sm mb-6">
                                        <strong>Conciliação Automática:</strong> Envie o arquivo da Placa (WLN) e o do Nível (CSV) para o sistema cruzar os horários.
                                    </div>

                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                        <div className={`p-6 rounded-2xl border-2 border-dashed transition-all ${wlnFile ? 'border-green-400 bg-green-50' : 'border-gray-300 hover:border-blue-400'}`}>
                                            <h3 className="font-bold text-gray-700 mb-2 flex items-center"><Fuel className="w-5 h-5 mr-2"/> 1. Telemetria (WLN)</h3>
                                            {wlnFile ? <div className="text-green-700 font-medium truncate">{wlnFile.name}</div> : <FileUpload onFileSelect={handleFileSelect} />}
                                        </div>

                                        <div className={`p-6 rounded-2xl border-2 border-dashed transition-all ${tankFile ? 'border-green-400 bg-green-50' : 'border-gray-300 hover:border-blue-400'}`}>
                                            <h3 className="font-bold text-gray-700 mb-2 flex items-center"><Settings className="w-5 h-5 mr-2"/> 2. Nível Tanque (CSV)</h3>
                                            {tankFile ? <div className="text-green-700 font-medium truncate">{tankFile.name}</div> : <FileUpload onFileSelect={handleFileSelect} />}
                                        </div>
                                    </div>

                                    {wlnFile && tankFile && processedData.length === 0 && (
                                        <button
                                            onClick={handleProcessConciliation}
                                            className="w-full py-4 bg-blue-600 hover:bg-blue-700 text-white rounded-xl font-bold text-lg shadow-lg hover:shadow-blue-200 transition-all active:scale-95"
                                        >
                                            Processar Conciliação
                                        </button>
                                    )}
                                </div>
                            ) : (
                                <>
                                    {currentMode === 'travado' && (
                                        <div className="mb-8 p-6 bg-purple-50 rounded-2xl border border-purple-100 flex flex-col md:flex-row items-center gap-4">
                                            <div className="w-full md:w-48"><label className="text-xs font-bold text-purple-800 uppercase ml-1">Último ID Válido</label><input type="number" className="w-full mt-1 px-4 py-3 rounded-xl border border-purple-200 outline-none" value={startIdInput} onChange={(e) => setStartIdInput(e.target.value)} /></div>
                                        </div>
                                    )}
                                    <FileUpload onFileSelect={handleFileSelect} />
                                </>
                            )}

                            {isProcessing && <div className="mt-8 text-center text-blue-600 animate-pulse">Cruzando dados...</div>}

                            {processedData.length > 0 && (
                                <div className="mt-8 animate-fade-in-up">
                                    <div className="flex items-center justify-between mb-4 bg-green-50 p-4 rounded-xl border border-green-100">
                                        <div className="flex items-center gap-3">
                                            <div className="p-2 bg-green-100 rounded-lg text-green-600"><FileSpreadsheet className="w-6 h-6" /></div>
                                            <div>
                                                <p className="font-bold text-green-900">Pronto para Exportar!</p>
                                                <p className="text-sm text-green-700">Edite as placas e baixe a planilha injetando no seu molde.</p>
                                            </div>
                                        </div>
                                        <button onClick={handleDownloadClick} className="bg-green-600 hover:bg-green-700 text-white px-6 py-3 rounded-xl font-bold flex items-center shadow-lg transition-all active:scale-95">
                                            <Download className="w-5 h-5 mr-2" /> Baixar Excel
                                        </button>
                                    </div>

                                    <div className="overflow-x-auto border border-gray-200 rounded-xl shadow-sm max-h-[500px]">
                                        <table className="w-full text-sm text-left relative">
                                            <thead className="bg-gray-100 text-gray-600 font-bold sticky top-0 z-10 shadow-sm">
                                            <tr>
                                                <th className="px-4 py-3 whitespace-nowrap">Data</th>
                                                <th className="px-4 py-3 whitespace-nowrap">ID Operação</th>
                                                <th className="px-4 py-3 whitespace-nowrap text-blue-600 flex items-center gap-1"><Edit3 className="w-4 h-4"/> Placa</th>
                                                <th className="px-4 py-3 whitespace-nowrap">Volume (L)</th>
                                                <th className="px-4 py-3 whitespace-nowrap">Frentista</th>
                                                <th className="px-4 py-3 whitespace-nowrap">Odômetro</th>
                                            </tr>
                                            </thead>
                                            <tbody>
                                            {processedData.map((row, i) => (
                                                <tr key={i} className="border-t border-gray-100 hover:bg-gray-50 transition-colors">
                                                    <td className="px-4 py-3 whitespace-nowrap">{row['Data'] || row['Data Inicial']}</td>
                                                    <td className="px-4 py-3 whitespace-nowrap font-mono">{row['ID Operação'] || row['ID Original (Travado)']}</td>
                                                    <td className="px-4 py-2">
                                                        <input
                                                            type="text"
                                                            placeholder="EX: ABC1234"
                                                            className="border border-blue-200 rounded-lg px-3 py-1.5 w-28 focus:ring-2 focus:ring-blue-500 outline-none uppercase font-bold text-gray-700 bg-white shadow-sm"
                                                            value={row['Veículo (Cartão)'] ?? row['Veículo'] ?? ''}
                                                            onChange={(e) => {
                                                                if (row['Veículo'] !== undefined) handleRowEdit(i, 'Veículo', e.target.value.toUpperCase());
                                                                else handleRowEdit(i, 'Veículo (Cartão)', e.target.value.toUpperCase());
                                                            }}
                                                        />
                                                    </td>
                                                    <td className="px-4 py-3 font-bold whitespace-nowrap text-gray-700">
                                                        {row['Volume (L)']}
                                                    </td>
                                                    <td className="px-4 py-3 whitespace-nowrap">{row['Frentista']}</td>
                                                    <td className="px-4 py-3 whitespace-nowrap">{row['Odômetro']}</td>
                                                </tr>
                                            ))}
                                            </tbody>
                                        </table>
                                    </div>
                                </div>
                            )}

                            {isModalOpen && (
                                <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4 backdrop-blur-sm animate-in fade-in duration-200">
                                    <div className="bg-white rounded-2xl shadow-2xl p-6 w-full max-w-md border border-gray-100">
                                        <div className="flex justify-between items-center mb-4">
                                            <h3 className="text-xl font-bold text-gray-800">Identificar e Exportar</h3>
                                            <button onClick={() => setIsModalOpen(false)} className="p-1 hover:bg-gray-100 rounded-full text-gray-500"><X className="w-6 h-6" /></button>
                                        </div>

                                        <div className="mb-4 bg-blue-50 p-4 rounded-xl border border-blue-100">
                                            <label className="block text-sm font-bold text-blue-800 mb-2">
                                                1. Planilha Molde (Obrigatório)
                                            </label>
                                            <input
                                                type="file"
                                                accept=".xlsx"
                                                className="w-full text-sm text-gray-500 file:mr-4 file:py-2 file:px-4 file:rounded-xl file:border-0 file:text-sm file:font-semibold file:bg-blue-600 file:text-white hover:file:bg-blue-700 outline-none"
                                                onChange={(e) => setTemplateFile(e.target.files?.[0] || null)}
                                            />
                                            <p className="text-xs text-blue-600 mt-2 leading-tight">Certifique-se de que o molde tenha as fórmulas puxadas para baixo o suficiente.</p>
                                        </div>

                                        <div className="mb-4">
                                            <label className="block text-sm font-semibold text-gray-700 mb-2">
                                                2. Nome da Bomba (Vai dentro da planilha)
                                            </label>
                                            <input
                                                type="text"
                                                placeholder="Ex: Bomba SMARTANK 641 (Grupo Roça...)"
                                                className="w-full px-4 py-3 rounded-xl border border-gray-300 focus:border-blue-500 outline-none"
                                                value={pumpName}
                                                onChange={(e) => setPumpName(e.target.value)}
                                            />
                                        </div>

                                        <div className="mb-6">
                                            <label className="block text-sm font-semibold text-gray-700 mb-2">
                                                3. Código do Cliente (Vai no nome do arquivo)
                                            </label>
                                            <input
                                                type="text"
                                                placeholder="Ex: roca644"
                                                className="w-full px-4 py-3 rounded-xl border border-gray-300 focus:border-blue-500 outline-none"
                                                value={fileNameClient}
                                                onChange={(e) => setFileNameClient(e.target.value)}
                                                onKeyDown={(e) => e.key === 'Enter' && confirmDownload()}
                                            />
                                        </div>

                                        <div className="flex gap-3">
                                            <button onClick={() => setIsModalOpen(false)} className="flex-1 px-4 py-3 rounded-xl font-semibold text-gray-600 hover:bg-gray-100">Cancelar</button>
                                            <button onClick={confirmDownload} className="flex-1 px-4 py-3 rounded-xl font-bold text-white bg-blue-600 hover:bg-blue-700 shadow-lg">Injetar e Baixar</button>
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