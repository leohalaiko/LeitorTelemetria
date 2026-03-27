import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { SpeedInsights } from '@vercel/speed-insights/react' // <-- Importação correta para React
import { Analytics } from '@vercel/analytics/react'
import './index.css'
import App from './App.tsx'

createRoot(document.getElementById('root')!).render(
    <StrictMode>
        <App />
        <SpeedInsights /> {/* <-- Componente adicionado aqui */}
        <Analytics />
    </StrictMode>,
)