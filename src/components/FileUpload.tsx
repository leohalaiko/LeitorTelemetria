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
        if (e.type === 'dragenter' || e.type === 'dragover') {
            setIsDragging(true);
        } else if (e.type === 'dragleave') {
            setIsDragging(false);
        }
    };

    const handleDrop = (e: React.DragEvent) => {
        e.preventDefault();
        e.stopPropagation();
        setIsDragging(false);

        if (e.dataTransfer.files && e.dataTransfer.files[0]) {
            onFileSelect(e.dataTransfer.files[0]);
        }
    };

    const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        if (e.target.files && e.target.files[0]) {
            onFileSelect(e.target.files[0]);
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
            onClick={() => inputRef.current?.click()}
        >
            <input
                ref={inputRef}
                type="file"
                className="hidden"
                // ADICIONADO: .wln na lista de aceitos
                accept=".csv,.txt,.xlsx,.wln"
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