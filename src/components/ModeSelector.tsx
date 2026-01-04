import React from 'react';
// AQUI ESTAVA O ERRO: Precisamos garantir que Fuel, AlertTriangle, Lock e FileWarning estejam importados
import { Fuel, AlertTriangle, Lock, FileWarning } from 'lucide-react';

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
            id: 'sonda',
            title: 'Sem Encerrante (Sonda)',
            desc: 'Funcionalidade em desenvolvimento (Requer Arqueação)',
            icon: <AlertTriangle className="w-8 h-8 text-gray-400" />,
            color: 'border-gray-100 bg-gray-50 opacity-60 cursor-not-allowed',
            bgIcon: 'bg-gray-200',
            disabled: true
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
            id: 'erro',
            title: 'Erro de Trama',
            desc: 'Logs com falha de GPS (valid=0) ou Sensor (can_r25)',
            icon: <FileWarning className="w-8 h-8 text-red-500" />,
            color: 'hover:border-red-500 hover:bg-red-50',
            bgIcon: 'bg-red-50',
            disabled: false
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