const fs = require('fs');
let code = fs.readFileSync('index.html', 'utf8');

// 1. Fix CSS typo for black.gif on #nav, #chatbox, #aboutme-box
code = code.replace(
  `linear-gradient(0deg,
          rgba(255, 255, 255, 0.3),
          rgba(255, 255, 255, 0.3)) url("src/black.gif");`,
  `linear-gradient(0deg,
          rgba(255, 255, 255, 0.3),
          rgba(255, 255, 255, 0.3)), url("src/black.gif");`
);

// 2. Add cursor and position to #pfp
code = code.replace(
  `#pfp {
      background-image: url("src/oiiai.gif");
      background-size: cover;
      width: 140px;
      height: 115px;
    }`,
  `#pfp {
      background-image: url("src/oiiai.gif");
      background-size: cover;
      width: 140px;
      height: 115px;
      cursor: pointer;
      position: relative;
      z-index: 1;
    }`
);

// 3. Re-add the Track Info HTML
if (!code.includes('id="trackDescription"')) {
  code = code.replace(
    `<button id="btnShowMore" class="btn-show-more">SHOW MORE</button>\n        </div>`,
    `<button id="btnShowMore" class="btn-show-more">SHOW MORE</button>\n          \n          <div class="playlist-header" style="margin-top: 25px;">\n            <img src="https://soapbubbleseal.net/h02-icon-shell.gif" class="headericon" />\n            Track Info\n          </div>\n          <div id="trackDescription" style="\n            background: #000;\n            border: 2px dashed #7f0fd5;\n            color: #55c1ef;\n            padding: 12px;\n            font-size: 14px;\n            text-shadow: none;\n            line-height: 1.4;\n            font-family: 'VT323', monospace;\n            font-size: 17px;\n          ">\n            (Loading track info...)\n          </div>\n        </div>`
  );
}

// 4. Re-add loadTrack functionality
if (!code.includes('trackDescription.innerText = track.description')) {
  code = code.replace(
    `function loadTrack(index) {
      const track = playlist[index];
      trackTitle.innerText = track.title;`,
    `function loadTrack(index) {
      const track = playlist[index];
      trackTitle.innerText = track.title;

      const trackDescription = document.getElementById("trackDescription");
      if (trackDescription) {
        trackDescription.innerText = track.description || "Descrição em breve...";
      }`
  );
}

// 5. Fix Visitor Counter
code = code.replace(
  `count += Math.floor(Math.random() * 3);`,
  `count += 1;`
);

// 6. Re-add PFP Zoom JS exactly before closing script tag
if (!code.includes('/* ------------- PFP Zoom Animation ------------- */')) {
  code = code.replace(
    `    bsod.addEventListener("click", () => {
      bsod.classList.remove("active");
    });
  </script>`,
    `    bsod.addEventListener("click", () => {
      bsod.classList.remove("active");
    });

    /* ------------- PFP Zoom Animation ------------- */
    document.getElementById("pfp").addEventListener("click", function (e) {
      if (document.getElementById("pfp-clone")) return;
      const rect = this.getBoundingClientRect();
      const clone = this.cloneNode(true);
      clone.id = "pfp-clone";
      clone.style.position = "fixed";
      clone.style.top = rect.top + "px";
      clone.style.left = rect.left + "px";
      clone.style.margin = "0";
      clone.style.zIndex = "999999";
      clone.style.transition = "all 0.5s cubic-bezier(0.25, 1, 0.5, 1)";
      document.body.appendChild(clone);
      this.style.opacity = "0";

      setTimeout(() => {
        clone.style.top = "50%";
        clone.style.left = "50%";
        clone.style.transform = "translate(-50%, -50%) scale(5)";
      }, 50);

      setTimeout(() => {
        clone.style.top = rect.top + "px";
        clone.style.left = rect.left + "px";
        clone.style.transform = "translate(0, 0) scale(1)";
      }, 2500);

      setTimeout(() => {
        clone.remove();
        this.style.opacity = "1";
      }, 3000);
    });
  </script>`
  );
}

// 7. Inject Track descriptions
let playlists_regex = /const playlist = \[([\s\S]*?)\];/;
let match = code.match(playlists_regex);
if (match && !match[1].includes('description:')) {
  let p = match[1];
  p = p.replace(/size: "4\.5 MB",/g, 'size: "4.5 MB",\n        description: "Essa é a primeira música em que tentei entender a estrutura básica de um drum \'n bass misturado com elementos de jogos de PS1. Bastante nostálgica e repetitiva, mas com um charme único."');
  p = p.replace(/size: "3\.1 MB",/g, 'size: "3.1 MB",\n        description: "Uma track mais melancólica e atmosférica, feita em uma tarde de chuva. Traz uma sensação de espera e contemplação."');
  p = p.replace(/size: "6\.2 MB",/g, 'size: "6.2 MB",\n        description: "Um ritmo constante que parece uma descida infinita por uma escadaria de 8-bits."');
  p = p.replace(/size: "2\.8 MB",/g, 'size: "2.8 MB",\n        description: "Animada e saltitante. Perfeita para uma fase de água de um jogo dos anos 2000."');
  p = p.replace(/size: "1\.9 MB",/g, 'size: "1.9 MB",\n        description: "Chiptune bem básico e direto, feito apenas com ondas quadradas puras."');
  p = p.replace(/size: "5\.1 MB",/g, 'size: "5.1 MB",\n        description: "Neon, carros rápidos e pores do sol em grade. Uma homenagem aos timbres clássicos dos anos 80."');
  p = p.replace(/size: "2\.4 MB",/g, 'size: "2.4 MB",\n        description: "Minha primeira tentativa de fazer os \'wobble basses\' rasgados de Dubstep."');
  p = p.replace(/size: "7\.0 MB",/g, 'size: "7.0 MB",\n        description: "Uma mistura inusitada de percussão drum and bass frenética com alaúdes medievais e elementos rústicos."');
  p = p.replace(/size: "8\.5 MB",/g, 'size: "8.5 MB",\n        description: "Música ambiente microtonal, evocando as telas de loading misteriosas de meados de 2000."');
  p = p.replace(/size: "3\.3 MB",/g, 'size: "3.3 MB",\n        description: "Foco nos graves! Um chiptune que balança os fones."');
  p = p.replace(/size: "4\.8 MB",/g, 'size: "4.8 MB",\n        description: "Lofi calminho para ouvir enquanto a chuva bate na janela."');
  p = p.replace(/size: "6\.0 MB",/g, 'size: "6.0 MB",\n        description: "Batidas densas para caminhadas noturnas, misturando synth pop com trip hop."');
  p = p.replace(/size: "2\.6 MB",/g, 'size: "2.6 MB",\n        description: "Começa como uma bossa nova tranquila, mas aos poucos os sintetizadores corrompem a melodia."');
  code = code.replace(match[0], `const playlist = [${p}];`);
}

fs.writeFileSync('index.html', code);
console.log("Restoration Complete.");
