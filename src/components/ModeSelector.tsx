import React from 'react';
import { Fuel, AlertTriangle, Lock, FileWarning, FileCode, ClipboardEdit } from 'lucide-react'; // Adicionei ClipboardEdit

interface ModeSelectorProps {
    onSelectMode: (mode: string) => void;
}

export const ModeSelector: React.FC<ModeSelectorProps> = ({ onSelectMode }) => {
    const modes = [
        {
            id: 'normal',
            title: 'Abastecimento Normal',
            desc: 'Fluxômetro operando corretamente (upar4 e upar6)',
            icon: <Fuel className="w-8 h-8 text-blue-500" />,
            color: 'hover:border-blue-500 hover:bg-blue-50',
            bgIcon: 'bg-blue-50',
            disabled: false
        },
        {
            id: 'transcricao', // <--- NOVO MODO
            title: 'Transcrição Manual (Fluxômetro OFF)',
            desc: 'Gera o Excel com TODOS os registros para edição manual da litragem.',
            icon: <ClipboardEdit className="w-8 h-8 text-orange-500" />,
            color: 'hover:border-orange-500 hover:bg-orange-50',
            bgIcon: 'bg-orange-50',
            disabled: false
        },
        {
            id: 'travado',
            title: 'ID Travado',
            desc: 'Cartão identificado mas sem registro de volume (Vol = 0)',
            icon: <Lock className="w-8 h-8 text-purple-500" />,
            color: 'hover:border-purple-500 hover:bg-purple-50',
            bgIcon: 'bg-purple-50',
            disabled: false
        },
        {
            id: 'wln',
            title: 'Leitor WLN (Debug)',
            desc: 'Importar arquivo bruto .WLN ou .TXT para análise técnica',
            icon: <FileCode className="w-8 h-8 text-indigo-500" />,
            color: 'hover:border-indigo-500 hover:bg-indigo-50',
            bgIcon: 'bg-indigo-50',
            disabled: false
        },
        {
            id: 'sonda',
            title: 'Sem Encerrante (Sonda)',
            desc: 'Funcionalidade em desenvolvimento (Requer Arqueação)',
            icon: <AlertTriangle className="w-8 h-8 text-gray-400" />,
            color: 'border-gray-100 bg-gray-50 opacity-60 cursor-not-allowed',
            bgIcon: 'bg-gray-200',
            disabled: true
        }
    ];

    return (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 max-w-4xl mx-auto mt-8 animate-fade-in-up">
            {modes.map((mode) => (
                <button
                    key={mode.id}
                    onClick={() => !mode.disabled && onSelectMode(mode.id)}
                    disabled={mode.disabled}
                    className={`
            flex flex-col items-start p-6 
            bg-white border-2 border-gray-100 rounded-2xl 
            transition-all duration-300 shadow-sm
            ${mode.disabled ? '' : 'hover:shadow-md group cursor-pointer'} 
            ${mode.color} text-left w-full
          `}
                >
                    <div className={`p-3 ${mode.bgIcon} rounded-xl mb-4 ${mode.disabled ? '' : 'group-hover:scale-110'} transition-transform`}>
                        {mode.icon}
                    </div>
                    <h3 className={`text-lg font-bold mb-1 ${mode.disabled ? 'text-gray-400' : 'text-gray-800'}`}>
                        {mode.title}
                    </h3>
                    <p className="text-sm text-gray-500">{mode.desc}</p>
                </button>
            ))}
        </div>
    );
};