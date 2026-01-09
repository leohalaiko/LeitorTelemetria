import React, { useRef, useState } from 'react';
import { Upload } from 'lucide-react';

interface FileUploadProps {
    onFileSelect: (file: File) => void;
}

export const FileUpload: React.FC<FileUploadProps> = ({ onFileSelect }) => {
    const [isDragging, setIsDragging] = useState(false);
    const inputRef = useRef<HTMLInputElement>(null);

    const handleDrag = (e: React.DragEvent) => {
        e.preventDefault();
        e.stopPropagation();

        // Log para garantir que o drag está sendo detectado
        if (e.type === 'dragenter' || e.type === 'dragover') {
            if (!isDragging) console.log('[FileUpload] Drag Enter/Over detectado');
            setIsDragging(true);
        } else if (e.type === 'dragleave') {
            console.log('[FileUpload] Drag Leave detectado');
            setIsDragging(false);
        }
    };

    const handleDrop = (e: React.DragEvent) => {
        e.preventDefault();
        e.stopPropagation();
        setIsDragging(false);

        console.log('[FileUpload] Evento DROP disparado.');

        // Verifica o objeto dataTransfer completo
        console.log('[FileUpload] dataTransfer:', e.dataTransfer);

        // Verifica a lista de arquivos
        if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
            const file = e.dataTransfer.files[0];
            console.log('[FileUpload] Arquivo recebido via DROP:', {
                nome: file.name,
                tipo: file.type || 'NÃO DETECTADO (Comum para .wln)',
                tamanho: file.size,
                extensao: file.name.split('.').pop()
            });

            onFileSelect(file);
        } else {
            console.warn('[FileUpload] Evento DROP ocorreu, mas nenhum arquivo foi encontrado em e.dataTransfer.files.');
        }
    };

    const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        console.log('[FileUpload] Evento CHANGE do input (seleção manual) disparado.');

        if (e.target.files && e.target.files[0]) {
            const file = e.target.files[0];

            console.log('[FileUpload] Arquivo selecionado via INPUT:', {
                nome: file.name,
                tipo: file.type || 'NÃO DETECTADO (Comum para .wln)',
                tamanho: file.size,
                extensao: file.name.split('.').pop()
            });

            onFileSelect(file);
        } else {
            console.warn('[FileUpload] Evento CHANGE disparado, mas e.target.files está vazio.');
        }
    };

    return (
        <div
            onDragEnter={handleDrag}
            onDragLeave={handleDrag}
            onDragOver={handleDrag}
            onDrop={handleDrop}
            className={`
        relative w-full max-w-2xl mx-auto h-64 
        rounded-3xl border-2 border-dashed transition-all duration-300
        flex flex-col items-center justify-center cursor-pointer
        bg-white group
        ${isDragging
                ? 'border-blue-500 bg-blue-50 scale-105 shadow-xl'
                : 'border-gray-200 hover:border-blue-400 hover:bg-gray-50'
            }
      `}
            onClick={() => {
                console.log('[FileUpload] Clicou na área de upload, abrindo explorador de arquivos...');
                inputRef.current?.click();
            }}
        >
            <input
                ref={inputRef}
                type="file"
                className="hidden"
                // DICA: Às vezes o navegador é estrito com extensões.
                // Adicionei '*' como fallback caso o sistema operacional não reconheça .wln
                accept=".csv,.txt,.xlsx,.wln,*"
                onChange={handleChange}
            />

            <div className={`p-4 rounded-full mb-4 transition-colors ${isDragging ? 'bg-blue-100' : 'bg-gray-100 group-hover:bg-blue-50'}`}>
                <Upload className={`w-8 h-8 ${isDragging ? 'text-blue-600' : 'text-gray-400 group-hover:text-blue-500'}`} />
            </div>

            <p className="text-lg font-medium text-gray-700">
                {isDragging ? 'Solte o arquivo aqui' : 'Clique ou arraste o arquivo'}
            </p>
            <p className="text-sm text-gray-400 mt-2">
                Suporta CSV, TXT, WLN ou Excel
            </p>
        </div>
    );
};