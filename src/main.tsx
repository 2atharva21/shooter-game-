import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
// @ts-ignore - global CSS side-effect import for Vite/Tailwind
import './style.css'
import App from './App.tsx'

const rootEl = document.getElementById('root')!
createRoot(rootEl).render(
  <StrictMode>
    <App />
  </StrictMode>
)
