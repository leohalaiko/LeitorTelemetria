import React, { useRef, useState } from 'react';
import { UploadCloud } from 'lucide-react';

interface FileUploadProps {
    onFileSelect: (file: File) => void;
    acceptText?: string;
}

export function FileUpload({ onFileSelect, acceptText = "Suporta arquivo .WLN" }: FileUploadProps) {
    const [isDragging, setIsDragging] = useState(false);
    const inputRef = useRef<HTMLInputElement>(null);

    const handleDrag = (e: React.DragEvent) => {
        e.preventDefault();
        e.stopPropagation();
        if (e.type === 'dragenter' || e.type === 'dragover') setIsDragging(true);
        else if (e.type === 'dragleave') setIsDragging(false);
    };

    const handleDrop = (e: React.DragEvent) => {
        e.preventDefault();
        e.stopPropagation();
        setIsDragging(false);
        if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
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
            onDragEnter={handleDrag} onDragLeave={handleDrag} onDragOver={handleDrag} onDrop={handleDrop}
            className={`relative w-full h-48 rounded-2xl border-2 border-dashed transition-all duration-300 flex flex-col items-center justify-center cursor-pointer group ${isDragging ? 'border-blue-500 bg-blue-50 scale-105 shadow-xl' : 'border-gray-300 hover:border-blue-400 hover:bg-blue-50/50 bg-white'}`}
            onClick={() => inputRef.current?.click()}
        >
            <input ref={inputRef} type="file" className="hidden" accept=".csv,.txt,.xlsx,.wln,*" onChange={handleChange} />
            <div className={`p-4 rounded-full mb-3 transition-colors ${isDragging ? 'bg-blue-100 text-blue-600' : 'bg-gray-100 text-gray-400 group-hover:bg-blue-100 group-hover:text-blue-500'}`}>
                <UploadCloud className="w-8 h-8" />
            </div>
            <p className="text-base font-bold text-gray-700 mb-1">{isDragging ? 'Solte o arquivo aqui' : 'Clique ou arraste o arquivo'}</p>
            <p className="text-sm font-medium text-gray-400">{acceptText}</p>
        </div>
    );
}