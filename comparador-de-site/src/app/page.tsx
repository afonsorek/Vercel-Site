"use client";

import { useState, useRef } from "react";
import styles from "./page.module.css";
import { ArrowRightLeft, Download, Loader2 } from "lucide-react";
// @ts-ignore
import HtmlDiffModule from "htmldiff-js";

const HtmlDiff = HtmlDiffModule.default || HtmlDiffModule;

export default function Home() {
  const [url1, setUrl1] = useState("");
  const [url2, setUrl2] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [diffHtml, setDiffHtml] = useState<string | null>(null);
  
  const iframeRef = useRef<HTMLIFrameElement>(null);

  const handleCompare = async () => {
    if (!url1 || !url2) {
      setError("Por favor, preencha ambas as URLs.");
      return;
    }
    
    setIsLoading(true);
    setError(null);
    setDiffHtml(null);

    try {
      const response = await fetch("/api/fetch-html", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url1, url2 })
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.message || data.error || "Erro ao buscar os sites.");
      }

      const diffResult = HtmlDiff.execute(data.html1, data.html2);

      const injectedCss = `
        <style>
          del { background-color: rgba(239, 68, 68, 0.4) !important; text-decoration: line-through !important; color: inherit !important; }
          ins { background-color: rgba(34, 197, 94, 0.4) !important; text-decoration: none !important; color: inherit !important; }
        </style>
      `;
      
      const finalHtml = diffResult.includes("</head>") 
        ? diffResult.replace("</head>", `${injectedCss}</head>`)
        : injectedCss + diffResult;
      
      setDiffHtml(finalHtml);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setIsLoading(false);
    }
  };

  const handleExportPDF = () => {
    if (!iframeRef.current || !iframeRef.current.contentDocument) return;
    const iframeBody = iframeRef.current.contentDocument.body;
    
    // @ts-ignore
    const html2pdf = require('html2pdf.js');
    
    const opt = {
      margin:       10,
      filename:     'comparacao-site.pdf',
      image:        { type: 'jpeg' as const, quality: 0.98 },
      html2canvas:  { scale: 2, useCORS: true },
      jsPDF:        { unit: 'mm' as const, format: 'a4' as const, orientation: 'portrait' as const }
    };

    html2pdf().set(opt).from(iframeBody).save();
  };

  return (
    <div className={styles.container}>
      <header className={styles.header}>
        <h1 className={styles.title}>Comparador de Site</h1>
        <p className={styles.subtitle}>Analise e exporte as diferenças visuais entre duas páginas</p>
      </header>

      <div className={styles.controls}>
        <div className={styles.inputs}>
          <div className={styles.inputGroup}>
            <label className={styles.label}>Site Original (Remoções)</label>
            <input 
              className={styles.input}
              placeholder="https://exemplo.com/antigo"
              value={url1}
              onChange={(e) => setUrl1(e.target.value)}
            />
          </div>
          <div className={styles.inputGroup}>
            <label className={styles.label}>Site Novo (Adições)</label>
            <input 
              className={styles.input}
              placeholder="https://exemplo.com/novo"
              value={url2}
              onChange={(e) => setUrl2(e.target.value)}
            />
          </div>
        </div>
        
        <div className={styles.actions}>
          <button 
            className={`${styles.button} ${styles.buttonPrimary}`}
            onClick={handleCompare}
            disabled={isLoading}
          >
            {isLoading ? (
              <span className={styles.loading}><Loader2 className={styles.spinner} size={20} /> Carregando...</span>
            ) : (
              <><ArrowRightLeft size={20} /> Comparar</>
            )}
          </button>
          
          {diffHtml && (
            <button 
              className={`${styles.button} ${styles.buttonSecondary}`}
              onClick={handleExportPDF}
            >
              <Download size={20} /> Exportar PDF
            </button>
          )}
        </div>
        
        {error && <div className={styles.error}>{error}</div>}
      </div>

      {diffHtml && (
        <div className={styles.resultContainer}>
          <iframe 
            ref={iframeRef}
            srcDoc={diffHtml}
            className={styles.iframe}
            title="Resultado da Comparação"
          />
        </div>
      )}
    </div>
  );
}
