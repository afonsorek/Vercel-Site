import HtmlDiffModule from 'https://esm.sh/htmldiff-js@1.0.5';
const HtmlDiff = HtmlDiffModule.default || HtmlDiffModule;

document.addEventListener('DOMContentLoaded', () => {
  const url1Input = document.getElementById('url1Input');
  const url2Input = document.getElementById('url2Input');
  const compareBtn = document.getElementById('compareBtn');
  const compareBtnText = document.getElementById('compareBtnText');
  const exportBtn = document.getElementById('exportBtn');
  const errorBox = document.getElementById('errorBox');
  const resultContainer = document.getElementById('resultContainer');
  const resultIframe = document.getElementById('resultIframe');

  let currentDiffHtml = null;

  compareBtn.addEventListener('click', async () => {
    const url1 = url1Input.value.trim();
    const url2 = url2Input.value.trim();

    if (!url1 || !url2) {
      showError("Por favor, preencha ambas as URLs.");
      return;
    }

    setLoading(true);

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

      // Diff
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

      currentDiffHtml = finalHtml;
      
      resultIframe.srcdoc = currentDiffHtml;
      resultContainer.style.display = 'flex';
      exportBtn.style.display = 'inline-flex';

    } catch (err) {
      showError(err.message);
    } finally {
      setLoading(false);
    }
  });

  exportBtn.addEventListener('click', () => {
    if (!resultIframe.contentDocument) return;
    const iframeBody = resultIframe.contentDocument.body;

    const opt = {
      margin:       10,
      filename:     'comparacao-site.pdf',
      image:        { type: 'jpeg', quality: 0.98 },
      html2canvas:  { scale: 2, useCORS: true },
      jsPDF:        { unit: 'mm', format: 'a4', orientation: 'portrait' }
    };

    window.html2pdf().set(opt).from(iframeBody).save();
  });

  function showError(msg) {
    errorBox.textContent = msg;
    errorBox.style.display = 'block';
    resultContainer.style.display = 'none';
    exportBtn.style.display = 'none';
  }

  function hideError() {
    errorBox.style.display = 'none';
  }

  function setLoading(isLoading) {
    if (isLoading) {
      hideError();
      compareBtn.disabled = true;
      compareBtnText.textContent = "Carregando...";
    } else {
      compareBtn.disabled = false;
      compareBtnText.textContent = "Comparar";
    }
  }
});
