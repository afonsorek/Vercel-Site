/* ADA Grafos — grafo de menções positivas/negativas entre candidatos */
(() => {
  "use strict";

  // ---------- DOM ----------
  const $ = (id) => document.getElementById(id);
  const canvas = $("graph-canvas");
  const ctx = canvas.getContext("2d");
  const tooltip = $("tooltip");
  const fileInput = $("file-input");

  // ---------- Estado ----------
  const S = {
    nodes: [],
    nodeById: new Map(),
    mentions: [],
    pairLinks: [],
    edges: [],
    categories: [],
    activeCats: new Set(),
    showPos: true,
    showNeg: true,
    maxCount: 1,
    transform: d3.zoomIdentity,
    hoverEdge: null,
    hoverNode: null,
    focusNode: null,
    pinned: false,
    searchSet: null,
    previewNode: null,
    adj: new Map(),
    width: 0,
    height: 0,
    dpr: 1,
    nodeColorMode: "balance", // "balance" | "ratio" | "default"
    weightsEnabled: true,
    weightIntensity: 1.0,
    showWeightsOnEdges: true,
    rankingCalcMode: "weighted", // "weighted" | "raw"
    minNet: -10,
    maxNet: 10,
  };

  const COLORS = {
    pos: { h: 152, s0: 35, s1: 80, l0: 32, l1: 58 },
    neg: { h: 350, s0: 40, s1: 92, l0: 38, l1: 64 },
  };

  // ---------- Utilidades ----------
  const norm = (s) =>
    String(s || "")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/\s+/g, " ")
      .trim();

  const esc = (s) =>
    String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  const shortName = (name) => {
    const p = name.trim().split(/\s+/);
    return p.length <= 2 ? p.join(" ") : `${p[0]} ${p[p.length - 1]}`;
  };

  function detectDelimiter(text) {
    const eol = text.search(/\r|\n/);
    const line = text.slice(0, eol === -1 ? 5000 : eol);
    const count = (ch) => line.split(ch).length - 1;
    const c = { ",": count(","), ";": count(";"), "\t": count("\t") };
    return Object.entries(c).sort((a, b) => b[1] - a[1])[0][0];
  }

  function parseCSV(text) {
    if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
    const d = detectDelimiter(text);
    const rows = [];
    let row = [], field = "", q = false;
    const push = () => {
      row.push(field);
      field = "";
      if (row.length > 1 || row[0] !== "") rows.push(row);
      row = [];
    };
    for (let i = 0, n = text.length; i < n; i++) {
      const c = text[i];
      if (q) {
        if (c === '"') {
          if (text[i + 1] === '"') { field += '"'; i++; }
          else q = false;
        } else field += c;
      } else if (c === '"') q = true;
      else if (c === d) { row.push(field); field = ""; }
      else if (c === "\r" || c === "\n") push();
      else field += c;
    }
    if (field !== "" || row.length) push();
    return rows;
  }

  // ---------- Mapeamento de colunas ----------
  const COLS = {
    authorId: ["codigo ac do autor", "id do autor", "codigo do autor"],
    authorName: ["nome do autor", "autor"],
    targetId: ["codigo ac do avaliado", "id do avaliado", "codigo do avaliado"],
    targetName: ["nome do avaliado", "avaliado"],
    type: ["tipo de mencao", "tipo"],
    attr: ["atributo", "categoria"],
    choice: ["escolha"],
    comment: ["comentario", "comentario original"],
    question: ["pergunta original", "pergunta"],
  };

  function mapColumns(header) {
    const h = header.map(norm);
    const idx = {};
    for (const [key, names] of Object.entries(COLS)) {
      idx[key] = -1;
      for (const n of names) {
        const i = h.indexOf(n);
        if (i !== -1) { idx[key] = i; break; }
      }
    }
    return idx;
  }


  // ---------- Fotos de Perfil e Correspondência Inteligente ----------
  const DEFAULT_PHOTOS_MANIFEST = [
  "20261023_184317_405 - Nathália.jpg",
  "215B8990-4F16-4075-B0B9-55C591DF5BF2 - Tiago.jpg",
  "FOTODEPERFIL_ESTHERRATZKEWERNERBAGGIO - Esther Ratzke.jpg",
  "FOTODOCUMENTO_BEATRIZMAKIYAMAKLOSOWSKI - Beatriz Makiyama.jpg",
  "FOTOPERFIL_AMANDAMACHADODESMOTS - Amanda Machado.jpg",
  "FOTOPERFIL_ANACAROLINEDEMACEDOSTOCCO - ANA CAROLINE DE MACEDO STOCCO.jpg",
  "FOTOPERFIL_ANAHEBELLOPEREIRA - 花愛.jpg",
  "FOTOPERFIL_ANALUIZABURGER - ana burger(1).jpg",
  "FOTOPERFIL_ANALUIZABURGER - ana burger.jpg",
  "FOTOPERFIL_ANDRELUIZMARQUESDACUNHA - André Luiz Marques da Cunha.jpg",
  "FOTOPERFIL_ANDRIELICHEVA - Andrieli Cheva.jpg",
  "FOTOPERFIL_ANGELOLUIGIFERRONATO - Angelo Ferronato.jpg",
  "FOTOPERFIL_ANTUNIGIULLIANORIBEIRODASILVA - Antuni ribeiro.jpg",
  "FOTOPERFIL_ARTHURDEOLIVEIRACARVALHO - Arthur Oliveira.jpg",
  "FOTOPERFIL_ARTHURJOSEMAGALHAESCZERNIAK - Arthur Czerniak.jpg",
  "FOTOPERFIL_ARTHURRIBASDEOLIVEIRA - Arthur Ribas de Oliveira.jpg",
  "FOTOPERFIL_AYNEGABRIELEFIGUEIREDO - Ayne Gabriele.jpg",
  "FOTOPERFIL_BARBARAMORIEL - Bárbara Moriel.jpg",
  "FOTOPERFIL_BRENODEMIOPADILHA - Breno Padilha.jpg",
  "FOTOPERFIL_BRUNAKORSCHDEMELLORENAUX - Bruna Korsch.jpg",
  "FOTOPERFIL_CAIOKLOPPEL - Caio Klöppel.jpg",
  "FOTOPERFIL_CAMILAFEIJÓMINKU - Camila Feijó Minku.jpg",
  "FOTOPERFIL_CARLOSLEONARDOGARCIAPSCHEIDT - Carlos Leonardo.jpg",
  "FOTOPERFIL_CAROLINERODRIGUESDELIMA - Caroline Lima.jpg",
  "FOTOPERFIL_CESAR_AUGUSTO_PRÉCOMA_VENDRAMIN - Cesar.jpg",
  "FOTOPERFIL_DANIELSILVANATAL. - Daniel S. (Dan).jpg",
  "FOTOPERFIL_DANIELYSDAVILA - Danielys Davila.jpg",
  "FOTOPERFIL_DAYANARESENDEDEFREITAS - Dayana Freitas.jpg",
  "FOTOPERFIL_DIEGOFONSECADEOLIVEIRABONFIMSOARES - CharmanderGamer.jpg",
  "FOTOPERFIL_DIEGOMATHEUSDOSSANTOS - Diego Lazuli Dev.jpg",
  "FOTOPERFIL_DeboraDatschRodrigues - Debora Datsch.jpg",
  "FOTOPERFIL_EDUARDAAYUMINAKAMURA - Eduarda Nakamura.jpg",
  "FOTOPERFIL_EMANUELESACENTIDACOREGIO - Bakdorl.jpg",
  "FOTOPERFIL_EMELIZEBONFIMMLOT - Emelize Bonfim Mlot.jpg",
  "FOTOPERFIL_ENZOGUTIERREZYOSHIZUMI - TDM enzogy.jpg",
  "FOTOPERFIL_GABRIELAANTUNESBARAN - Gabe.jpg",
  "FOTOPERFIL_GABRIELABURGEL - gabs b.jpg",
  "FOTOPERFIL_GABRIELARIBEIROSCHMIDT - Gabriela Schmidt.jpg",
  "FOTOPERFIL_GABRIELESCORELGUERRA - Gabriel Guerra.jpg",
  "FOTOPERFIL_GABRIELLUCASBARBOSA - Gabriel Lucas.jpg",
  "FOTOPERFIL_GIOVANNARIBASDOSREIS - Giovanna Reis.jpg",
  "FOTOPERFIL_GUSTAVODOSSANTOSPOLIDO - Gustavo Pulido.jpg",
  "FOTOPERFIL_GUSTAVOFINDERVILELADEFARIAS - Gustavo Finder Vilela de Farias.jpg",
  "FOTOPERFIL_Giovana.Gonçalves.Do.Nascimento - Giovana.jpg",
  "FOTOPERFIL_HECTORVIEIRASALDIVAR - Hector Vieira Saldivar.jpg",
  "FOTOPERFIL_HELENAKSANALVES - Helena.jpg",
  "FOTOPERFIL_HENRIQUEMOLETTA - Henrique moletta.jpg",
  "FOTOPERFIL_ISABELAFUJIWARAPAULIN - Isabela Fujiwara.jpg",
  "FOTOPERFIL_ISABELLALUCENACONCEICAO - Isabella Lucena(1).jpg",
  "FOTOPERFIL_ISABELLALUCENACONCEICAO - Isabella Lucena.jpg",
  "FOTOPERFIL_ISADORAMULLER - Isa Müller.jpg",
  "FOTOPERFIL_ISAQUESIMÕESDOSSANTOS - Isaque Simões dos Santos.jpg",
  "FOTOPERFIL_JEANDERSONRIBEIROSALVEGO - Jeanderson Ribeiro Salvego.jpg",
  "FOTOPERFIL_JEANPABLOLOPESTEIXEIRA - Jean Pablo.jpg",
  "FOTOPERFIL_JOAOPEDROFIGURABURKOT - João Pedro Figura Burkot.jpg",
  "FOTOPERFIL_JOAOVICTORSABOYARIBEIRODECARVALHO - João Victor Carvalho.jpg",
  "FOTOPERFIL_JOAOVITORBARALHASALVARES - João Vitor Baralhas Alvares.jpg",
  "FOTOPERFIL_JOAOVITORMATSUMOTO - joao matsumoto.jpg",
  "FOTOPERFIL_JoaoAfonsoBadinOrth - joao afonso.jpg",
  "FOTOPERFIL_KATHLEENDANIELLYSOUZALINS - Kathleen Danielly.jpg",
  "FOTOPERFIL_KEDLINDALLAVECCHIAFERNANDES - Kedlin.jpg",
  "FOTOPERFIL_KODALISMARAVALHASGONCALVES - KODA LIS MARAVALHAS GONCALVES.jpg",
  "FOTOPERFIL_LARAEDUARDALEDER - Lara Leder.jpg",
  "FOTOPERFIL_LARISSAGABRIELAFRARE - Larissa Frare.jpg",
  "FOTOPERFIL_LETICIAJUSTINOWEHBE - Leh Justino Wehbe.jpg",
  "FOTOPERFIL_LETÍCIAPATERNORIBEIRO - Letícia Paterno Ribeiro.jpg",
  "FOTOPERFIL_LORENALEDUCMALUFDASILVA - lorena leduc.jpg",
  "FOTOPERFIL_LUANENRICOSANTANAPECA - Luan Enrico.jpg",
  "FOTOPERFIL_LUCASCICARELLOGIRATA - Lucas Cicarello Girata.jpg",
  "FOTOPERFIL_LUCASVILAINMATRAS - Lucas Vilain Matras.jpg",
  "FOTOPERFIL_LUCASÁLVARESFERREIRAWALKOWSKI - LW.jpg",
  "FOTOPERFIL_LUISA_COTINHO_DE_MELO - LUISA COTINHO DE MELO.jpg",
  "FOTOPERFIL_LUIZABIANCOLINI - Luiza Biancolini.jpg",
  "FOTOPERFIL_LUÍSA PEDROSO LUCAS  - Luísa Pedroso.jpg",
  "FOTOPERFIL_MALUHIKARIANDOOYAMAGUCHI - Malu Hikari.jpg",
  "FOTOPERFIL_MANUELAROMODAADAS - Manuela Adas.jpg",
  "FOTOPERFIL_MARCOSEMANOELDOSSANTOS - Marcos Emanoel.jpg",
  "FOTOPERFIL_MARCOSFERNANDODEOLIVEIRAFILHO - Marcos Fernando.jpg",
  "FOTOPERFIL_MARIAEDUARDAMACHADODOSSANTOS - Maria Eduarda (Meari).jpg",
  "FOTOPERFIL_MARIANAMONKOLSKITATAREM - Mari Tatarem.jpg",
  "FOTOPERFIL_MELISSAKAFERCORRALES - Melissa Kafer Corrales.jpg",
  "FOTOPERFIL_MIGUELCASSAPULAMONTEIRODESOUZA - Miguel Henrique.jpg",
  "FOTOPERFIL_MURILOCAXAMBUMONTEIRO - Murilo Caxambu Monteiro.jpg",
  "FOTOPERFIL_MatheusSanchesMartins - Matheus Sanches.jpg",
  "FOTOPERFIL_NADIALUANALOBKOV - Nadia Lobkov.jpg",
  "FOTOPERFIL_NATANHENRIQUERAMOSSILVA - Natan Henrique.jpg",
  "FOTOPERFIL_NATHALIAFUJIWARAPAULIN - Nathalia Paulin.jpg",
  "FOTOPERFIL_NATHANGABRIELDEOLIVEIRAESILVA - Nathan Gabriel.jpg",
  "FOTOPERFIL_NICOLASCOSENZA - Nicolas Cosenza.jpg",
  "FOTOPERFIL_NICOLEITIBEREDACUNHAESILVA - Nicole Itiberê.jpg",
  "FOTOPERFIL_NINACALMONDEOLIVEIRA - Nina Calmon.jpg",
  "FOTOPERFIL_PEDRODAFONSECASCHWERTNER - Pedro da Fonseca Schwertner.jpg",
  "FOTOPERFIL_PEDROGABRIELDEBRITONERYSAVIO - Pedro Savio.jpg",
  "FOTOPERFIL_PEDROHENRIQUEDACOSTASILVA - Pedro Henrique da Costa Silva.jpg",
  "FOTOPERFIL_PEDROHENRIQUEHEERDTSEHNEMWICHERAL - Pedro Henrique.jpg",
  "FOTOPERFIL_PEDROVINICIUSSOUSADASILVA - Pedro Vinicius.jpg",
  "FOTOPERFIL_PIERRECRAZE - Pierre Craze.jpg",
  "FOTOPERFIL_RAPHAELANDREYFIAMONCINIZAKOVICZ - Raphael Zakovicz.jpg",
  "FOTOPERFIL_RODRIGODASILVAALVES - Rodrigo Alves.jpg",
  "FOTOPERFIL_RUBENSPAESNETO - Rubens Paes Neto.jpg",
  "FOTOPERFIL_SEUNOMECOMPLETO - Milena Torres Laynes.jpg",
  "FOTOPERFIL_SOFIAALICEDASILVA - sofia alice.jpg",
  "FOTOPERFIL_SOFIAMENEZESMATHEUS - Sofia Menezes Matheus.jpg",
  "FOTOPERFIL_TAHERDOVALLERBARROSHEBLING - Taher Hebling.jpg",
  "FOTOPERFIL_TAYNARADASILVADIAS - Taynara Da Silva Dias.jpg",
  "FOTOPERFIL_THALESROMAGNAFABROWSKISANTOS - Thales Santos.jpg",
  "FOTOPERFIL_THAYLONDIEGOFERREIRA - THAYLON DIEGO FERREIRA.jpg",
  "FOTOPERFIL_THIAGO IGOR MOTA - THIAGO IGOR MOTA.jpg",
  "FOTOPERFIL_THIAGOKENJINAKAMURAONO - Thiago Kenji.jpg",
  "FOTOPERFIL_TIAGOPAREJAVITA - Tiago.jpg",
  "FOTOPERFIL_VICTORIAAZEVEDODOVAL - Victoria Azevedo.jpg",
  "FOTOPERFIL_VINÍCIUSHASSE - Vinícius Hasse.jpg",
  "FOTOPERFIL_WALLACESILVINOPEREIRACOSTA - Wallace Costa.jpg",
  "FOTOPERFIL_WELLINGTONNERYGONCALVESDACOSTA - Wellington Nery.jpg",
  "FOTOPERFIL_WYLLAMSBRITO - ludo.jpg",
  "FOTOPERFIL_YASMINLACERDALOPES - Yasmin Lopes.jpg",
  "IMG-20261024-WA0000 - Ana Luiza.jpg",
  "IMG_20261023_235118 - Vitor Natal Cordeiro.jpg",
  "IMG_2886 - Rafaelle Reali Cavalheiro.jpg",
  "IMG_5090 - Nah Berbert.jpg",
  "IMG_7949 - Arthur Oliveira.jpg",
  "IMG_9420 - Felipe.jpg",
  "Screenshot 2026-10-22 at 19.27.09 - flora koti.jpg",
  "Screenshot_20260314_143208_Photos~2 - Lilian Waszak.jpg",
  "WhatsApp Image 2026-10-23 at 19.43.58 - SAYMON MARCHIORE.jpg"
];
  let availablePhotos = DEFAULT_PHOTOS_MANIFEST.slice();

  // Sincroniza lista de fotos com fotos_manifest.json se servido via HTTP
  try {
    fetch("fotos_manifest.json")
      .then((r) => (r.ok ? r.json() : null))
      .then((list) => {
        if (Array.isArray(list) && list.length) {
          availablePhotos = list;
          if (S.nodes && S.nodes.length) {
            matchCandidatePhotos(S.nodes, availablePhotos);
            requestRender();
          }
        }
      })
      .catch(() => {});
  } catch (_) {}

  function matchCandidatePhotos(nodes, photoList = availablePhotos) {
    if (!Array.isArray(photoList) || !photoList.length || !Array.isArray(nodes) || !nodes.length) return;

    const photoEntries = photoList.map((filename) => ({
      file: filename,
      norm: norm(filename),
      tokens: tokenize(filename).filter((w) => !["foto", "perfil", "fotoperfil", "fotodocumento", "fotodeperfil", "jpg", "jpeg", "png"].includes(w)),
    }));

    // Frequência do primeiro nome entre os candidatos da planilha
    const firstNameCounts = new Map();
    nodes.forEach((n) => {
      const toks = tokenize(n.name).filter((w) => !["de", "da", "do", "dos", "das", "e"].includes(w));
      if (toks.length) {
        const fn = toks[0];
        firstNameCounts.set(fn, (firstNameCounts.get(fn) || 0) + 1);
      }
    });

    const matchedPhotos = new Set();
    const matchedNodes = new Map();

    function evaluateMatch(node, entry) {
      const nTokens = tokenize(node.name).filter((w) => !["de", "da", "do", "dos", "das", "e"].includes(w));
      if (!nTokens.length) return 0;
      const nNorm = norm(node.name);
      const fn = nTokens[0];
      const surnames = nTokens.slice(1);
      const fnIsDuplicated = (firstNameCounts.get(fn) || 0) > 1;

      // 1. Correspondência exata do nome completo
      if (entry.norm.includes(nNorm) && nNorm.length >= 5) {
        return 1000 + nTokens.length * 20;
      }

      // Presença do primeiro nome
      const hasFn = entry.tokens.some((t) => t === fn || (fn.length > 3 && (t.startsWith(fn) || fn.startsWith(t)))) || entry.norm.includes(fn);

      // Presença de sobrenomes
      const matchedSurnames = surnames.filter((sn) =>
        entry.tokens.some((t) => t === sn || (sn.length > 3 && (t.startsWith(sn) || sn.startsWith(t)))) || entry.norm.includes(sn)
      );

      // Cuidado crítico para nomes repetidos (Pedro, Arthur, Lucas, João, etc.):
      // Exige OBRIGATORIAMENTE ao menos 1 sobrenome correspondente
      if (fnIsDuplicated) {
        if (!hasFn || matchedSurnames.length === 0) return 0;
        return 500 + matchedSurnames.length * 50;
      }

      // Primeiro nome único na turma com sobrenome correspondente
      if (hasFn && matchedSurnames.length >= 1) {
        return 400 + matchedSurnames.length * 50;
      }

      // Sobrenome raro/distintivo presente no arquivo (ex: Berbert, Czerniak, Brito)
      if (matchedSurnames.length >= 1 && matchedSurnames.some((sn) => sn.length >= 5)) {
        return 300 + matchedSurnames.length * 40;
      }

      // Primeiro nome único no dataset (ex: Tiago, Felipe) quando não há ambiguidade
      if (hasFn && !fnIsDuplicated) {
        return 150;
      }

      return 0;
    }

    // Processa candidatos com nomes mais comuns primeiro para alocar seus sobrenomes exatos
    const candidatesSorted = [...nodes].sort((a, b) => {
      const fnA = (tokenize(a.name).filter((w) => !["de", "da", "do", "dos", "das", "e"].includes(w))[0]) || "";
      const fnB = (tokenize(b.name).filter((w) => !["de", "da", "do", "dos", "das", "e"].includes(w))[0]) || "";
      const countA = firstNameCounts.get(fnA) || 0;
      const countB = firstNameCounts.get(fnB) || 0;
      return countB - countA;
    });

    for (const node of candidatesSorted) {
      let bestEntry = null;
      let bestScore = 0;

      for (const entry of photoEntries) {
        if (matchedPhotos.has(entry.file)) continue;
        const score = evaluateMatch(node, entry);
        if (score > bestScore) {
          bestScore = score;
          bestEntry = entry;
        }
      }

      if (bestEntry && bestScore > 0) {
        matchedPhotos.add(bestEntry.file);
        matchedNodes.set(node.id, bestEntry.file);
        const url = "fotos_de_perfil/" + encodeURIComponent(bestEntry.file);
        node.photo = url;
        const img = new Image();
        img.src = url;
        node.photoImg = img;
      }
    }

    // Pass 2: Candidatos restantes não alocados com primeiro nome entre arquivos remanescentes
    for (const node of nodes) {
      if (matchedNodes.has(node.id)) continue;
      const nTokens = tokenize(node.name).filter((w) => !["de", "da", "do", "dos", "das", "e"].includes(w));
      if (!nTokens.length) continue;
      const fn = nTokens[0];

      for (const entry of photoEntries) {
        if (matchedPhotos.has(entry.file)) continue;
        const hasFn = entry.tokens.includes(fn) || entry.norm.includes(fn);
        if (hasFn) {
          matchedPhotos.add(entry.file);
          matchedNodes.set(node.id, entry.file);
          const url = "fotos_de_perfil/" + encodeURIComponent(entry.file);
          node.photo = url;
          const img = new Image();
          img.src = url;
          node.photoImg = img;
          break;
        }
      }
    }
  }

  // ---------- Construção do grafo ----------
  function buildData(text) {
    const rows = parseCSV(text);
    if (rows.length < 2) throw new Error("O arquivo está vazio ou não possui linhas de dados.");
    const idx = mapColumns(rows[0]);
    const missing = [];
    if (idx.authorName < 0 && idx.authorId < 0) missing.push("Nome do autor");
    if (idx.targetName < 0 && idx.targetId < 0) missing.push("Nome do avaliado");
    if (idx.type < 0) missing.push("Tipo de menção");
    if (missing.length) throw new Error(`Colunas obrigatórias não encontradas: ${missing.join(", ")}.`);

    const get = (r, k) => (idx[k] >= 0 ? (r[idx[k]] ?? "").trim() : "");
    const nodeById = new Map();
    const mentions = [];
    const ensureNode = (id, name) => {
      let n = nodeById.get(id);
      if (!n) {
        n = { id, name: name || id, recvPos: 0, recvNeg: 0, givePos: 0, giveNeg: 0 };
        n.short = shortName(n.name);
        n.key = `${norm(n.name)} ${norm(id)}`;
        nodeById.set(id, n);
      }
      return n;
    };

    for (let i = 1; i < rows.length; i++) {
      const r = rows[i];
      const aName = get(r, "authorName"), tName = get(r, "targetName");
      const aId = get(r, "authorId") || aName, tId = get(r, "targetId") || tName;
      if (!aId || !tId || aId === tId) continue;
      const t = norm(get(r, "type"));
      const type = t.startsWith("posit") ? "pos" : t.startsWith("negat") ? "neg" : null;
      if (!type) continue;
      const a = ensureNode(aId, aName), b = ensureNode(tId, tName);
      if (type === "pos") { a.givePos++; b.recvPos++; } else { a.giveNeg++; b.recvNeg++; }
      mentions.push({
        src: aId, tgt: tId, type,
        attr: get(r, "attr") || "Sem categoria",
        choice: get(r, "choice"),
        comment: get(r, "comment"),
        question: get(r, "question"),
      });
    }
    if (!mentions.length) throw new Error("Nenhuma menção Positiva/Negativa válida foi encontrada.");

    const nodes = [...nodeById.values()];
    nodes.forEach((n) => {
      n.r = 7 + Math.sqrt(n.recvPos + n.recvNeg) * 1.7;
      n.net = n.recvPos - n.recvNeg;
      n.total = n.recvPos + n.recvNeg;
      n.ratio = n.total > 0 ? n.recvPos / n.total : 0.5;
    });

    const netScores = nodes.map((n) => n.net);
    const minNet = netScores.length ? Math.min(...netScores) : -10;
    const maxNet = netScores.length ? Math.max(...netScores) : 10;
    S.minNet = minNet;
    S.maxNet = maxNet;

    // Vincular fotos de perfil correspondentes aos candidatos da planilha
    matchCandidatePhotos(nodes);

    // Atribuir pesos iniciais em cada menção baseado na reputação do avaliador
    mentions.forEach((m) => {
      const auth = nodeById.get(m.src);
      const s = auth ? auth.net : 0;
      const range = maxNet > minNet ? maxNet - minNet : 1;
      const normNet = Math.max(0, Math.min(1, (s - minNet) / range));
      m.weight = Math.max(0.1, Math.min(4.0, Math.round((1.0 + (normNet - 0.5) * 2.0) * 10) / 10));
    });

    // Links não direcionais para o layout (independem dos filtros)
    const pairMap = new Map();
    for (const m of mentions) {
      const k = m.src < m.tgt ? `${m.src}\u0000${m.tgt}` : `${m.tgt}\u0000${m.src}`;
      const p = pairMap.get(k);
      if (p) p.w++;
      else pairMap.set(k, { source: m.src, target: m.tgt, w: 1 });
    }

    const categories = [...new Set(mentions.map((m) => m.attr))];
    return { nodes, nodeById, mentions, pairLinks: [...pairMap.values()], categories };
  }

  function aggregateEdges() {
    const map = new Map();
    for (const m of S.mentions) {
      if (!S.activeCats.has(m.attr)) continue;
      if (m.type === "pos" && !S.showPos) continue;
      if (m.type === "neg" && !S.showNeg) continue;
      const k = `${m.src}\u0000${m.tgt}\u0000${m.type}`;
      let e = map.get(k);
      if (!e) {
        e = { source: S.nodeById.get(m.src), target: S.nodeById.get(m.tgt), type: m.type, items: [] };
        map.set(k, e);
      }
      e.items.push(m);
    }
    const edges = [...map.values()];

    edges.forEach((e) => {
      e.rawCount = e.items.length;
      e.weightedCount = Math.round(e.items.reduce((acc, m) => acc + (m.weight ?? 1.0), 0) * 10) / 10;
      e.effectiveCount = S.weightsEnabled ? e.weightedCount : e.rawCount;
    });

    // Agrupar por par para calcular curvaturas (ida e volta separadas)
    const pairs = new Map();
    for (const e of edges) {
      const a = e.source.id < e.target.id ? e.source : e.target;
      e.canonA = a;
      e.canonB = a === e.source ? e.target : e.source;
      const k = `${e.canonA.id}\u0000${e.canonB.id}`;
      (pairs.get(k) || pairs.set(k, []).get(k)).push(e);
    }
    for (const list of pairs.values()) {
      const fwd = list.filter((e) => e.source === e.canonA).sort((x, y) => (x.type < y.type ? 1 : -1));
      const bwd = list.filter((e) => e.source !== e.canonA).sort((x, y) => (x.type < y.type ? 1 : -1));
      if (fwd.length && bwd.length) {
        fwd.forEach((e, j) => (e.curve = j + 1));
        bwd.forEach((e, j) => (e.curve = -(j + 1)));
      } else {
        const one = fwd.length ? fwd : bwd;
        if (one.length === 1) one[0].curve = 0;
        else one.forEach((e, j) => (e.curve = j === 0 ? 1 : -1));
      }
    }

    const observedMax = edges.reduce((m, e) => Math.max(m, e.effectiveCount), 1);
    S.maxCount = observedMax;
    edges.forEach((e) => {
      e.t = S.maxCount > 1 ? (e.effectiveCount - 1) / (S.maxCount - 1) : 1;
      // Estilo pré-calculado: espessura proporcional ao peso e intensidade
      const weightRatio = S.weightsEnabled ? Math.max(0.7, Math.min(1.8, e.weightedCount / (e.rawCount || 1))) : 1;
      e.w = (0.9 + 2.2 * Math.max(0, Math.min(1, e.t))) * weightRatio;
      e.color = edgeColor(e.type, e.t);
      e.key = `${e.type}${e.rawCount}_${S.weightsEnabled ? e.weightedCount : ''}`;
    });
    edges.sort((a, b) => a.items.length - b.items.length);
    S.edges = edges;

    // Adjacência dos nós (para o modo foco, sem varrer todas as arestas a cada quadro)
    const adj = new Map();
    const link = (a, b) => (adj.get(a) || adj.set(a, new Set()).get(a)).add(b);
    for (const e of edges) { link(e.source, e.target); link(e.target, e.source); }
    S.adj = adj;

    // Lado oposto (para mostrar no tooltip)
    const byKey = new Map(edges.map((e) => [`${e.source.id}\u0000${e.target.id}\u0000${e.type}`, e]));
    edges.forEach((e) => {
      e.reverse = ["pos", "neg"].map((t) => byKey.get(`${e.target.id}\u0000${e.source.id}\u0000${t}`)).filter(Boolean);
    });

    renderStats();
    requestRender();
  }

  // ---------- Cores ----------
  function edgeColor(type, t, alphaMul = 1) {
    const c = COLORS[type];
    const s = c.s0 + (c.s1 - c.s0) * t;
    const l = c.l0 + (c.l1 - c.l0) * t;
    const a = (0.35 + 0.65 * t) * alphaMul;
    return `hsla(${c.h}, ${s}%, ${l}%, ${a})`;
  }

  // ---------- Geometria das arestas ----------
  function edgeGeom(e) {
    const s = e.source, t = e.target;
    const a = e.canonA, b = e.canonB;
    const dx = b.x - a.x, dy = b.y - a.y;
    const dist = Math.hypot(dx, dy) || 1;
    const nx = -dy / dist, ny = dx / dist;

    // Em modo foco: setas mais retas, elegantes e sem sobreposição
    const isFocusEdge = S.focusNode && (s === S.focusNode || t === S.focusNode);
    let off;
    if (isFocusEdge) {
      // Quando e.curve === 0 (seta única), fica reta (off = 0)
      // Quando há ida e volta, dá uma leve separação lateral controlada (6px a 12px)
      off = e.curve === 0 ? 0 : Math.sign(e.curve) * (7 + Math.abs(e.curve) * 3);
    } else {
      off = e.curve * Math.min(Math.max(dist * 0.14, 10), 42);
    }

    const cx = (s.x + t.x) / 2 + nx * off * 2;
    const cy = (s.y + t.y) / 2 + ny * off * 2;

    let ux = cx - s.x, uy = cy - s.y, ul = Math.hypot(ux, uy) || 1;
    const sx = s.x + (ux / ul) * (s.r + 1), sy = s.y + (uy / ul) * (s.r + 1);
    let vx = t.x - cx, vy = t.y - cy, vl = Math.hypot(vx, vy) || 1;
    const ex = t.x - (vx / vl) * (t.r + 2), ey = t.y - (vy / vl) * (t.r + 2);
    return { sx, sy, cx, cy, ex, ey, ang: Math.atan2(ey - cy, ex - cx) };
  }

  function distToEdge(g, px, py) {
    let best = Infinity, lx = g.sx, ly = g.sy;
    const N = 16;
    for (let i = 1; i <= N; i++) {
      const t = i / N, mt = 1 - t;
      const x = mt * mt * g.sx + 2 * mt * t * g.cx + t * t * g.ex;
      const y = mt * mt * g.sy + 2 * mt * t * g.cy + t * t * g.ey;
      best = Math.min(best, segDist(px, py, lx, ly, x, y));
      lx = x; ly = y;
    }
    return best;
  }

  function segDist(px, py, x1, y1, x2, y2) {
    const dx = x2 - x1, dy = y2 - y1;
    const l2 = dx * dx + dy * dy;
    let t = l2 ? ((px - x1) * dx + (py - y1) * dy) / l2 : 0;
    t = Math.max(0, Math.min(1, t));
    return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy));
  }

  // ---------- Renderização ----------
  let raf = 0;
  function requestRender() {
    if (!raf) raf = requestAnimationFrame(() => { raf = 0; draw(); });
  }

  function resize() {
    S.dpr = window.devicePixelRatio || 1;
    S.width = window.innerWidth;
    S.height = window.innerHeight;
    canvas.width = S.width * S.dpr;
    canvas.height = S.height * S.dpr;
    requestRender();
  }

  // ---------- Reputação e Pesos ----------
  function getAuthorReputation(authorId) {
    const n = S.nodeById.get(authorId);
    if (!n) return { net: 0, ratio: 0.5, weight: 1.0, level: "mid" };

    if (!S.weightsEnabled || S.weightIntensity === 0) {
      return { net: n.net, ratio: n.ratio, weight: 1.0, level: "mid" };
    }

    const minNet = S.minNet ?? -10;
    const maxNet = S.maxNet ?? 10;
    const range = maxNet > minNet ? maxNet - minNet : 1;
    const normNet = Math.max(0, Math.min(1, (n.net - minNet) / range));

    const rawWeight = 1.0 + S.weightIntensity * (normNet - 0.5) * 2.0;
    const weight = Math.max(0.1, Math.min(4.0, Math.round(rawWeight * 10) / 10));
    const level = weight >= 1.3 ? "high" : weight <= 0.7 ? "low" : "mid";
    return { net: n.net, ratio: n.ratio, weight, level };
  }

  function recalculateWeights() {
    if (!S.mentions.length) return;
    for (const m of S.mentions) {
      m.weight = getAuthorReputation(m.src).weight;
    }
    aggregateEdges();
  }

  // ---------- Paletas e Sprites dos Nós ----------
  const THEMES = {
    default: {
      hl: { c0: "#e4e5ff", c1: "#8f92ff", c2: "#3d3fb0", glow: "rgba(139,140,248,0.9)" },
      normal: { c0: "#c9cbff", c1: "#7376e6", c2: "#2d2f86" },
      ring: "rgba(255,255,255,0.18)",
    },
    // Verde Vibrante para Saldo Positivo
    pos_high: {
      hl: { c0: "#ecfdf5", c1: "#34d399", c2: "#047857", glow: "rgba(52,211,153,0.95)" },
      normal: { c0: "#6ee7b7", c1: "#10b981", c2: "#065f46" },
      ring: "rgba(52,211,153,0.55)",
    },
    pos_mid: {
      hl: { c0: "#f0fdf4", c1: "#4ade80", c2: "#15803d", glow: "rgba(74,222,128,0.9)" },
      normal: { c0: "#86efac", c1: "#22c55e", c2: "#166534" },
      ring: "rgba(74,222,128,0.45)",
    },
    // Roxo/Índigo Neutro para Saldo Zero
    neutral: {
      hl: { c0: "#e0e7ff", c1: "#818cf8", c2: "#312e81", glow: "rgba(129,140,248,0.9)" },
      normal: { c0: "#c7d2fe", c1: "#6366f1", c2: "#3730a3" },
      ring: "rgba(129,140,248,0.35)",
    },
    // Vermelho/Rubi Vibrante para Saldo Negativo
    neg_mid: {
      hl: { c0: "#fff1f2", c1: "#fb7185", c2: "#9f1239", glow: "rgba(251,113,133,0.95)" },
      normal: { c0: "#fda4af", c1: "#f43f5e", c2: "#881337" },
      ring: "rgba(251,113,133,0.45)",
    },
    neg_high: {
      hl: { c0: "#fff1f2", c1: "#f43f5e", c2: "#881337", glow: "rgba(239,68,68,1.0)" },
      normal: { c0: "#fca5a5", c1: "#ef4444", c2: "#7f1d1d" },
      ring: "rgba(239,68,68,0.6)",
    },
  };

  function getNodeTier(n) {
    if (S.nodeColorMode === "default") return "default";
    if (S.nodeColorMode === "ratio") {
      const r = n.ratio ?? 0.5;
      if (r > 0.6) return "pos_high";
      if (r > 0.5) return "pos_mid";
      if (r === 0.5) return "neutral";
      if (r >= 0.4) return "neg_mid";
      return "neg_high";
    }
    // "balance" (Saldo de avaliações: Verde = Positivo, Vermelho = Negativo, Neutro = 0)
    const net = n.net ?? 0;
    if (net >= 3) return "pos_high";
    if (net >= 1) return "pos_mid";
    if (net === 0) return "neutral";
    if (net >= -2) return "neg_mid";
    return "neg_high";
  }

  function makeThemeSprite(colors, highlighted, r) {
    const pad = highlighted ? r * 2 : 2;
    const c = document.createElement("canvas");
    c.width = c.height = Math.ceil((r + pad) * 2);
    const g = c.getContext("2d");
    const o = c.width / 2;
    if (highlighted && colors.glow) {
      g.shadowColor = colors.glow;
      g.shadowBlur = r * 1.5;
    }
    const grad = g.createRadialGradient(o - r * 0.35, o - r * 0.4, r * 0.1, o, o, r);
    grad.addColorStop(0, colors.c0);
    grad.addColorStop(0.45, colors.c1);
    grad.addColorStop(1, colors.c2);
    g.beginPath();
    g.arc(o, o, r, 0, Math.PI * 2);
    g.fillStyle = grad;
    g.fill();
    return { img: c, r, k: o / r };
  }

  const SPRITE_SIZES = [8, 16, 32, 64, 128, 256];
  const SPRITES = {};
  for (const [key, theme] of Object.entries(THEMES)) {
    SPRITES[key] = {
      normal: SPRITE_SIZES.map((r) => makeThemeSprite(theme.normal, false, r)),
      hl: SPRITE_SIZES.map((r) => makeThemeSprite(theme.hl, true, r)),
    };
  }

  const spriteFor = (set, screenR) => set.find((s) => s.r >= screenR) || set[set.length - 1];

  const DIM_COLOR = { pos: edgeColor("pos", 0.5, 0.09), neg: edgeColor("neg", 0.5, 0.09) };

  function viewBounds(pad) {
    const T = S.transform;
    return {
      x0: -T.x / T.k - pad, y0: -T.y / T.k - pad,
      x1: (S.width - T.x) / T.k + pad, y1: (S.height - T.y) / T.k + pad,
    };
  }

  // Define o que fica aceso: aresta sob o mouse, nó em foco, ou resultados da busca
  function computeHighlight() {
    const focus = S.focusNode || S.previewNode || (S.hoverEdge ? null : S.hoverNode);
    let lit = null, activeOf = null;
    if (focus) {
      lit = new Set(S.adj.get(focus) || []);
      lit.add(focus);
      activeOf = (e) => e.source === focus || e.target === focus;
    } else if (S.searchSet) {
      const set = S.searchSet;
      lit = new Set(set);
      activeOf = (e) => set.has(e.source) || set.has(e.target);
    }
    if (S.hoverEdge) {
      const he = S.hoverEdge;
      lit = lit || new Set();
      lit.add(he.source);
      lit.add(he.target);
      activeOf = (e) => e === he;
    }
    return { focus, lit, activeOf };
  }

  function addEdgePath(b, g) {
    const head = b.head;
    const bx = g.ex - Math.cos(g.ang) * head * 0.8; // linha termina na base da seta
    const by = g.ey - Math.sin(g.ang) * head * 0.8;
    b.line.moveTo(g.sx, g.sy);
    b.line.quadraticCurveTo(g.cx, g.cy, bx, by);
    b.tip.moveTo(g.ex, g.ey);
    b.tip.lineTo(g.ex - head * Math.cos(g.ang - 0.42), g.ey - head * Math.sin(g.ang - 0.42));
    b.tip.lineTo(g.ex - head * Math.cos(g.ang + 0.42), g.ey - head * Math.sin(g.ang + 0.42));
    b.tip.closePath();
  }

  const newBucket = (color, w) => ({ color, w, head: 5 + w * 1.6, line: new Path2D(), tip: new Path2D() });
  function getBucket(map, key, color, w) {
    let b = map.get(key);
    if (!b) map.set(key, (b = newBucket(color, w)));
    return b;
  }
  function paintBucket(b) {
    ctx.strokeStyle = b.color;
    ctx.fillStyle = b.color;
    ctx.lineWidth = b.w;
    ctx.stroke(b.line);
    ctx.fill(b.tip);
  }

  function draw() {
    const { dpr, transform: T } = S;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (!S.nodes.length) return;
    ctx.setTransform(dpr * T.k, 0, 0, dpr * T.k, dpr * T.x, dpr * T.y);

    const { focus, lit, activeOf } = computeHighlight();
    const dimming = !!activeOf;

    const isFocused = !!S.focusNode;

    // Arestas agrupadas por estilo: poucos stroke()/fill() por quadro em vez de 2 por seta.
    // S.edges está ordenado por intensidade, então as mais fortes ficam por cima.
    const vb = viewBounds(20 / T.k);
    const dimB = new Map(), actB = new Map();
    let hovered = null;
    const activeEdges = [];

    for (const e of S.edges) {
      const g = (e.g = edgeGeom(e));
      if (
        Math.max(g.sx, g.cx, g.ex) < vb.x0 || Math.min(g.sx, g.cx, g.ex) > vb.x1 ||
        Math.max(g.sy, g.cy, g.ey) < vb.y0 || Math.min(g.sy, g.cy, g.ey) > vb.y1
      ) continue; // fora da tela

      if (e === S.hoverEdge) { hovered = e; continue; }

      const isActive = !dimming || activeOf(e);
      if (isFocused && !isActive) {
        // No modo foco: oculta arestas de terceiros para visualização máxima de clareza
        continue;
      }

      if (isActive) {
        const b = getBucket(actB, e.key, e.color, isFocused ? e.w * 1.3 : e.w);
        addEdgePath(b, g);
        if (isFocused && (e.source === S.focusNode || e.target === S.focusNode)) {
          activeEdges.push(e);
        }
      } else {
        const b = getBucket(dimB, e.type, DIM_COLOR[e.type], 1.2);
        addEdgePath(b, g);
      }
    }
    ctx.lineCap = "butt";
    dimB.forEach(paintBucket);
    actB.forEach(paintBucket);

    // Se estiver em foco, ou se a opção de exibir pesos nas setas estiver ativa:
    if ((isFocused || S.showWeightsOnEdges) && activeEdges.length) {
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      const fsBadge = Math.max(9.5, 11 / T.k);
      ctx.font = `700 ${fsBadge}px Inter, sans-serif`;

      for (const e of activeEdges) {
        const g = e.g;
        // Posição ao longo da curva: leve deslocamento para arestas opostas evitarem sobreposição do badge
        const tPos = isFocused ? (e.source === S.focusNode ? 0.62 : 0.38) : 0.5;
        const mtPos = 1 - tPos;
        const mx = mtPos * mtPos * g.sx + 2 * mtPos * tPos * g.cx + tPos * tPos * g.ex;
        const my = mtPos * mtPos * g.sy + 2 * mtPos * tPos * g.cy + tPos * tPos * g.ey;

        const countStr = S.weightsEnabled && S.showWeightsOnEdges
          ? `${e.weightedCount.toFixed(1)}★`
          : `${e.rawCount}`;
        const badgeText = `${e.type === "pos" ? "+" : "−"}${countStr}`;

        // Padding aumentado e dimensões generosas para excelente legibilidade
        const padX = 14 / T.k;
        const padY = 8 / T.k;
        const textMetrics = ctx.measureText(badgeText);
        const textW = textMetrics.width;
        const badgeW = textW + padX * 2;
        const badgeH = fsBadge + padY * 2;
        const rx = mx - badgeW / 2, ry = my - badgeH / 2, r = badgeH / 2;

        ctx.fillStyle = "rgba(10, 13, 24, 0.96)";
        ctx.strokeStyle = e.type === "pos" ? "rgba(52, 211, 153, 0.95)" : "rgba(251, 113, 133, 0.95)";
        ctx.lineWidth = 1.4 / T.k;
        ctx.beginPath();
        if (ctx.roundRect) ctx.roundRect(rx, ry, badgeW, badgeH, r);
        else ctx.rect(rx, ry, badgeW, badgeH);
        ctx.fill();
        ctx.stroke();

        ctx.fillStyle = e.type === "pos" ? "#34d399" : "#fb7185";
        ctx.fillText(badgeText, mx, my + 0.5 / T.k);
      }
    }

    if (hovered) {
      const b = newBucket(edgeColor(hovered.type, 1), hovered.w * 1.6);
      addEdgePath(b, hovered.g);
      ctx.save();
      ctx.shadowColor = hovered.type === "pos" ? "rgba(52,211,153,0.8)" : "rgba(251,113,133,0.8)";
      ctx.shadowBlur = 14;
      paintBucket(b);
      ctx.restore();
    }

    // Nós (sprites) + contornos agrupados
    const nb = viewBounds(40 / T.k);
    const scale = T.k * dpr;
    const ringN = new Path2D(), ringF = new Path2D(), ringH = new Path2D(), ringS = new Path2D();
    const addCircle = (p, x, y, r) => { p.moveTo(x + r, y); p.arc(x, y, r, 0, Math.PI * 2); };
    const visible = [];
    for (const n of S.nodes) {
      if (n.x + n.r < nb.x0 || n.x - n.r > nb.x1 || n.y + n.r < nb.y0 || n.y - n.r > nb.y1) continue;
      visible.push(n);
      const isNeighbor = lit && lit.has(n);
      const isFocal = n === S.focusNode;
      const faded = dimming && !isNeighbor;
      const hl = n === S.hoverNode || n === focus || isFocal;

      const tier = getNodeTier(n);
      const themeSet = SPRITES[tier] || SPRITES.default;
      const sp = spriteFor(hl ? themeSet.hl : themeSet.normal, n.r * scale);
      const d = n.r * sp.k;

      // No modo foco: nós desconectados ficam com opacidade quase invisível (0.025)
      ctx.globalAlpha = faded ? (isFocused ? 0.025 : 0.18) : 1;
      ctx.drawImage(sp.img, n.x - d, n.y - d, d * 2, d * 2);

      if (!faded || !isFocused) {
        addCircle(hl ? ringH : faded ? ringF : ringN, n.x, n.y, n.r);
        if (S.searchSet && S.searchSet.has(n)) addCircle(ringS, n.x, n.y, n.r + 4 / T.k);
      }
    }
    ctx.globalAlpha = 1;
    ctx.lineWidth = 1 / T.k;
    ctx.strokeStyle = "rgba(255,255,255,0.18)";
    ctx.stroke(ringN);
    ctx.strokeStyle = "rgba(255,255,255,0.035)";
    ctx.stroke(ringF);
    ctx.lineWidth = 2.2 / T.k;
    ctx.strokeStyle = "rgba(255,255,255,0.95)";
    ctx.stroke(ringH);
    ctx.lineWidth = 1.6 / T.k;
    ctx.strokeStyle = "rgba(167,169,255,0.95)";
    ctx.stroke(ringS);

    // Rótulos (fonte definida uma vez por grupo)
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    ctx.lineJoin = "round";
    ctx.lineWidth = 3.5 / T.k;
    ctx.strokeStyle = "rgba(11,14,23,0.92)";
    const fs = 11.5 / Math.min(T.k, 1.5);
    const off = 4 / T.k;
    const isLit = (n) => !!lit && lit.has(n);

    if (isFocused) {
      // Modo Foco: máxima clareza - SOMENTE o estudante em foco e seus vizinhos têm rótulos
      for (const n of visible) {
        if (!isLit(n)) continue;
        const isFocal = n === S.focusNode;
        ctx.font = `${isFocal ? 700 : 600} ${isFocal ? fs * 1.15 : fs}px Inter, sans-serif`;
        ctx.fillStyle = isFocal ? "#ffffff" : "#f1f3fd";
        const y = n.y + n.r + off;
        ctx.strokeText(n.short, n.x, y);
        ctx.fillText(n.short, n.x, y);
      }
    } else {
      const labels = (weight, fill, filter) => {
        ctx.font = `${weight} ${fs}px Inter, sans-serif`;
        ctx.fillStyle = fill;
        for (const n of visible) {
          if (!filter(n)) continue;
          const y = n.y + n.r + off;
          ctx.strokeText(n.short, n.x, y);
          ctx.fillText(n.short, n.x, y);
        }
      };
      if (T.k > 0.55) labels(500, dimming ? "rgba(200,205,225,0.15)" : "rgba(220,224,240,0.85)", (n) => !isLit(n));
      if (lit) labels(600, "#ffffff", isLit);
    }
  }

  // ---------- Hit testing ----------
  function worldPoint(ev) {
    const rect = canvas.getBoundingClientRect();
    return S.transform.invert([ev.clientX - rect.left, ev.clientY - rect.top]);
  }

  function findNode(x, y) {
    for (let i = S.nodes.length - 1; i >= 0; i--) {
      const n = S.nodes[i];
      if (Math.hypot(n.x - x, n.y - y) <= n.r + 2 / S.transform.k) return n;
    }
    return null;
  }

  function findEdge(x, y) {
    const tol = 6 / S.transform.k;
    const focus = S.focusNode;
    let best = null, bestD = tol;
    for (let i = S.edges.length - 1; i >= 0; i--) {
      const e = S.edges[i];
      if (focus && e.source !== focus && e.target !== focus) continue;
      const g = e.g || (e.g = edgeGeom(e));
      // Rejeição rápida pela caixa envolvente da curva antes do cálculo fino
      if (
        x < Math.min(g.sx, g.cx, g.ex) - tol || x > Math.max(g.sx, g.cx, g.ex) + tol ||
        y < Math.min(g.sy, g.cy, g.ey) - tol || y > Math.max(g.sy, g.cy, g.ey) + tol
      ) continue;
      const d = distToEdge(g, x, y);
      if (d < bestD) { bestD = d; best = e; }
    }
    return best;
  }

  // ---------- Tooltip ----------
  function mentionList(items, type) {
    return `<ul class="tt-list">${items
      .map((m) => {
        const rep = getAuthorReputation(m.src);
        const weightTag = S.weightsEnabled
          ? `<span class="tt-author-rep ${rep.level}" title="Peso de avaliação de quem avaliou (Baseado na reputação: saldo ${rep.net > 0 ? '+' : ''}${rep.net})">Peso: ${rep.weight.toFixed(1)}x</span>`
          : "";
        return `<li class="${type}">
          <div class="tt-meta">
            <span class="tt-attr">${esc(m.attr)}</span>
            ${m.choice ? `<span class="tt-choice">· ${esc(m.choice)}</span>` : ""}
            ${weightTag}
          </div>
          ${m.comment ? `<p class="tt-comment">“${esc(m.comment)}”</p>` : `<p class="tt-comment empty">Sem comentário</p>`}
        </li>`;
      })
      .join("")}</ul>`;
  }

  function edgeSection(e) {
    const label = e.type === "pos" ? "Positiva" : "Negativa";
    const n = e.items.length;
    const weightInfo = S.weightsEnabled ? ` · Peso Total: <b>${e.weightedCount.toFixed(1)}★</b>` : "";
    return `<div class="tt-section">
      <div class="tt-route">${esc(e.source.name)}<span class="arrow ${e.type}">→</span>${esc(e.target.name)}</div>
      <span class="badge ${e.type}">${label} · ${n} ${n === 1 ? "menção" : "menções"}${weightInfo}</span>
      ${mentionList(e.items, e.type)}
    </div>`;
  }

  function edgeTooltipHTML(e) {
    let html = edgeSection(e);
    if (S.pinned && e.reverse.length) html += e.reverse.map(edgeSection).join("");
    else if (e.reverse.length) html += `<div class="tt-hint">↔ Existe avaliação no sentido oposto · clique para fixar e ver tudo</div>`;
    else html += `<div class="tt-hint">Clique para fixar este painel</div>`;
    return html;
  }

  function nodeTooltipHTML(n) {
    const rep = getAuthorReputation(n.id);
    const repInfo = S.weightsEnabled
      ? `<div class="muted" style="font-size:11.5px;margin-top:3px;">Peso como avaliador: <b style="color:#c5c7ff;">${rep.weight.toFixed(1)}x</b> (${rep.level === 'high' ? 'Alta reputação' : rep.level === 'low' ? 'Baixa reputação' : 'Reputação média'})</div>`
      : "";
    const netSign = n.net > 0 ? `+${n.net}` : `${n.net}`;
    const netColor = n.net > 0 ? "var(--pos)" : n.net < 0 ? "var(--neg)" : "var(--muted)";

    return `<div class="tt-node-name">${esc(n.name)}</div>
      <div class="muted" style="font-size:11.5px">${esc(n.id !== n.name ? n.id : "")} · Saldo: <b style="color:${netColor}">${netSign}</b></div>
      ${repInfo}
      <div class="tt-grid">
        <span></span><span class="h">Recebidas</span><span class="h">Dadas</span>
        <span style="color:var(--pos)">● Positivas</span><b>${n.recvPos}</b><b>${n.givePos}</b>
        <span style="color:var(--neg)">● Negativas</span><b>${n.recvNeg}</b><b>${n.giveNeg}</b>
      </div>
      <div class="tt-hint">${S.focusNode === n ? "Clique para sair do foco" : "Clique para focar nas relações"}</div>`;
  }

  let lastMouse = { x: 0, y: 0 };
  let ttW = 0, ttH = 0; // tamanho medido uma vez por conteúdo (evita reflow a cada mousemove)
  function showTooltip(html, cx, cy) {
    tooltip.innerHTML = (S.pinned ? `<button class="tt-close" id="tt-close" title="Fechar">×</button>` : "") + html;
    tooltip.classList.add("show");
    tooltip.setAttribute("aria-hidden", "false");
    ttW = tooltip.offsetWidth;
    ttH = tooltip.offsetHeight;
    positionTooltip(cx, cy);
    if (S.pinned) $("tt-close").onclick = unpin;
  }
  function positionTooltip(cx, cy) {
    const pad = 16;
    let x = cx + pad, y = cy + pad;
    if (x + ttW > S.width - 8) x = cx - ttW - pad;
    if (y + ttH > S.height - 8) y = Math.max(8, S.height - ttH - 8);
    // transform é composto na GPU, sem recalcular layout
    tooltip.style.transform = `translate3d(${Math.max(8, x)}px, ${Math.max(8, y)}px, 0)`;
  }
  function hideTooltip() {
    tooltip.classList.remove("show", "pinned");
    tooltip.setAttribute("aria-hidden", "true");
  }
  function unpin() {
    S.pinned = false;
    S.hoverEdge = null;
    hideTooltip();
    requestRender();
  }

  // ---------- Interações ----------
  function onMove(ev) {
    if (S.pinned || !S.nodes.length) return;
    lastMouse = { x: ev.clientX, y: ev.clientY };
    const [x, y] = worldPoint(ev);
    const n = findNode(x, y);
    const e = n ? null : findEdge(x, y);
    const changed = n !== S.hoverNode || e !== S.hoverEdge;
    S.hoverNode = n;
    S.hoverEdge = e;
    if (changed) {
      // Só reconstrói o HTML do tooltip quando o alvo muda
      canvas.classList.toggle("pointer", !!(n || e));
      if (e) showTooltip(edgeTooltipHTML(e), ev.clientX, ev.clientY);
      else if (n) showTooltip(nodeTooltipHTML(n), ev.clientX, ev.clientY);
      else hideTooltip();
      requestRender();
    } else if (n || e) positionTooltip(ev.clientX, ev.clientY);
  }

  function onClick(ev) {
    if (!S.nodes.length) return;
    const [x, y] = worldPoint(ev);
    const n = findNode(x, y);
    if (n) {
      if (S.pinned) unpin();
      setFocus(n);
      S.hoverNode = n;
      showTooltip(nodeTooltipHTML(n), ev.clientX, ev.clientY);
      return;
    }
    const e = findEdge(x, y);
    if (e) {
      S.pinned = true;
      S.hoverEdge = e;
      S.hoverNode = null;
      showTooltip(edgeTooltipHTML(e), ev.clientX, ev.clientY);
      tooltip.classList.add("pinned");
      requestRender();
      return;
    }
    if (S.pinned) unpin();
    else if (S.focusNode) { setFocus(null); }
  }

  // ---------- Zoom / drag ----------
  const zoom = d3
    .zoom()
    .scaleExtent([0.08, 6])
    .on("zoom", (ev) => {
      S.transform = ev.transform;
      if (S.pinned) unpin();
      requestRender();
    });

  const drag = d3
    .drag()
    .container(canvas)
    .subject((ev) => {
      const [x, y] = S.transform.invert([ev.x, ev.y]);
      const n = findNode(x, y);
      return n ? { node: n, x: S.transform.applyX(n.x), y: S.transform.applyY(n.y) } : null;
    })
    .on("start", (ev) => {
      if (!ev.active) S.sim.alphaTarget(0.25).restart();
      const n = ev.subject.node;
      n.fx = n.x; n.fy = n.y;
      S.hoverNode = null; // ao soltar, o próximo mousemove volta a mostrar o tooltip
      hideTooltip();
    })
    .on("drag", (ev) => {
      const n = ev.subject.node;
      const [x, y] = S.transform.invert([ev.x, ev.y]);
      n.fx = x; n.fy = y;
    })
    .on("end", (ev) => {
      if (!ev.active) S.sim.alphaTarget(0);
      const n = ev.subject.node;
      n.fx = null; n.fy = null;
    });

  d3.select(canvas).call(drag).call(zoom).on("dblclick.zoom", null);
  // Hit testing no máximo uma vez por quadro
  let pendingMove = null;
  canvas.addEventListener("mousemove", (ev) => {
    const idle = !pendingMove;
    pendingMove = ev;
    if (idle) requestAnimationFrame(() => { const e = pendingMove; pendingMove = null; onMove(e); });
  });
  canvas.addEventListener("click", onClick);
  canvas.addEventListener("mouseleave", () => {
    if (S.pinned) return;
    S.hoverEdge = S.hoverNode = null;
    hideTooltip();
    requestRender();
  });

  function fitView(duration = 600) {
    if (!S.nodes.length) return;
    const xs = S.nodes.map((n) => n.x), ys = S.nodes.map((n) => n.y);
    const x0 = Math.min(...xs) - 40, x1 = Math.max(...xs) + 40;
    const y0 = Math.min(...ys) - 40, y1 = Math.max(...ys) + 40;
    const panelW = $("panel").classList.contains("hidden") ? 0 : 330;
    const W = S.width - panelW, H = S.height;
    const k = Math.min(W / (x1 - x0), H / (y1 - y0), 2.5) * 0.95;
    const t = d3.zoomIdentity
      .translate(panelW + W / 2, H / 2)
      .scale(k)
      .translate(-(x0 + x1) / 2, -(y0 + y1) / 2);
    d3.select(canvas).transition().duration(duration).call(zoom.transform, t);
  }

  let focusAnim = null;
  function animatePositions(targets, duration = 480, onEnd = null) {
    if (focusAnim) cancelAnimationFrame(focusAnim);
    const start = performance.now();
    const items = [];
    for (const [node, t] of targets.entries()) {
      items.push({ node, sx: node.x, sy: node.y, tx: t.x, ty: t.y });
    }
    function tick(now) {
      const p = Math.min(1, (now - start) / duration);
      const ease = 1 - Math.pow(1 - p, 3); // easeOutCubic
      for (const it of items) {
        it.node.x = it.sx + (it.tx - it.sx) * ease;
        it.node.y = it.sy + (it.ty - it.sy) * ease;
      }
      requestRender();
      if (p < 1) {
        focusAnim = requestAnimationFrame(tick);
      } else {
        focusAnim = null;
        if (onEnd) onEnd();
      }
    }
    focusAnim = requestAnimationFrame(tick);
  }

  const focusCard = $("focus-card");
  function showFocusCard(n) {
    if (!focusCard) return;
    const nameEl = $("fc-name");
    const subEl = $("fc-sub");
    const photoEl = $("fc-photo");
    const fallbackEl = $("fc-fallback");
    const countersEl = $("fc-counters");
    const metricsEl = $("fc-metrics");

    if (nameEl) nameEl.textContent = n.name;
    if (subEl) subEl.textContent = n.id !== n.name ? n.id : "";

    const words = (n.name || "").trim().split(/\s+/).filter(Boolean);
    const initials = words.length > 1
      ? (words[0][0] + words[words.length - 1][0]).toUpperCase()
      : (words[0] ? words[0].slice(0, 2).toUpperCase() : "?");

    if (fallbackEl) fallbackEl.textContent = initials;

    if (photoEl) {
      if (n.photo) {
        photoEl.src = n.photo;
        photoEl.style.display = "block";
        if (fallbackEl) fallbackEl.style.display = "none";
        photoEl.onerror = () => {
          photoEl.style.display = "none";
          if (fallbackEl) fallbackEl.style.display = "flex";
        };
      } else {
        photoEl.style.display = "none";
        if (fallbackEl) fallbackEl.style.display = "flex";
      }
    }

    const netSign = n.net > 0 ? `+${n.net}` : `${n.net}`;
    const netColor = n.net > 0 ? "var(--pos)" : n.net < 0 ? "var(--neg)" : "var(--muted)";
    const neighbors = Array.from(S.adj.get(n) || []);

    if (countersEl) {
      countersEl.innerHTML = `
        <span class="pos">+${n.recvPos} recebidas</span>
        <span class="neg">−${n.recvNeg} recebidas</span>
        <span style="color:${netColor};font-weight:700;">Saldo: ${netSign}</span>
      `;
    }

    if (metricsEl) {
      const rep = getAuthorReputation(n.id);
      metricsEl.innerHTML = `
        <span>${neighbors.length} ${neighbors.length === 1 ? "relação conectada" : "relações conectadas"}</span>
        ${S.weightsEnabled ? ` · Peso de avaliador: <b>${rep.weight.toFixed(1)}x</b>` : ""}
      `;
    }

    focusCard.classList.remove("hidden");
  }

  function hideFocusCard() {
    if (focusCard) focusCard.classList.add("hidden");
  }

  if ($("fc-unfocus")) {
    $("fc-unfocus").onclick = () => setFocus(null);
  }

  function setFocus(n, { centerCamera = true } = {}) {
    if (!S.nodes.length) return;

    // Salvar posições naturais/originais de todos os nós
    for (const node of S.nodes) {
      if (node.homeX == null) {
        node.homeX = node.x;
        node.homeY = node.y;
      }
    }

    if (n === S.focusNode || !n) {
      // Sair do foco: animar nós de volta às suas posições originais
      const targets = new Map();
      for (const node of S.nodes) {
        if (node.homeX != null && (Math.abs(node.x - node.homeX) > 0.5 || Math.abs(node.y - node.homeY) > 0.5)) {
          targets.set(node, { x: node.homeX, y: node.homeY });
        }
      }
      S.focusNode = null;
      hideFocusCard();
      if (targets.size) {
        animatePositions(targets, 480);
      }
      requestRender();
      return;
    }

    S.focusNode = n;
    showFocusCard(n);

    // Agrupar nós vizinhos para perto do candidato selecionado
    const neighbors = Array.from(S.adj.get(n) || []);
    const targets = new Map();

    if (neighbors.length > 0) {
      // Ordenar vizinhos pelo ângulo natural em relação a n
      neighbors.sort((a, b) => {
        const angA = Math.atan2((a.homeY ?? a.y) - n.y, (a.homeX ?? a.x) - n.x);
        const angB = Math.atan2((b.homeY ?? b.y) - n.y, (b.homeX ?? b.x) - n.x);
        return angA - angB;
      });

      const M = neighbors.length;
      if (M <= 12) {
        const R = Math.max(160, Math.min(260, 110 + M * 12));
        neighbors.forEach((nb, i) => {
          const ang = (i / M) * Math.PI * 2 - Math.PI / 2;
          targets.set(nb, { x: n.x + Math.cos(ang) * R, y: n.y + Math.sin(ang) * R });
        });
      } else {
        // Dois anéis concêntricos se houver muitos vizinhos
        const M1 = Math.ceil(M / 2);
        const M2 = M - M1;
        const R1 = 170, R2 = 290;
        let c1 = 0, c2 = 0;
        neighbors.forEach((nb, i) => {
          if (i % 2 === 0) {
            const ang = (c1 / M1) * Math.PI * 2 - Math.PI / 2;
            targets.set(nb, { x: n.x + Math.cos(ang) * R1, y: n.y + Math.sin(ang) * R1 });
            c1++;
          } else {
            const ang = (c2 / M2) * Math.PI * 2 - Math.PI / 2 + Math.PI / M2;
            targets.set(nb, { x: n.x + Math.cos(ang) * R2, y: n.y + Math.sin(ang) * R2 });
            c2++;
          }
        });
      }

      animatePositions(targets, 480);
    }

    if (centerCamera) {
      // Zoom suave para enquadrar n e os nós agrupados com clareza total
      const allXs = [n.x, ...Array.from(targets.values()).map((p) => p.x)];
      const allYs = [n.y, ...Array.from(targets.values()).map((p) => p.y)];
      const x0 = Math.min(...allXs) - 75, x1 = Math.max(...allXs) + 75;
      const y0 = Math.min(...allYs) - 75, y1 = Math.max(...allYs) + 75;
      const panelW = $("panel").classList.contains("hidden") ? 0 : 330;
      const W = S.width - panelW, H = S.height;
      const k = Math.min(W / (x1 - x0), H / (y1 - y0), 2.2) * 0.92;
      const t = d3.zoomIdentity
        .translate(panelW + W / 2, H / 2)
        .scale(k)
        .translate(-(x0 + x1) / 2, -(y0 + y1) / 2);
      d3.select(canvas).transition().duration(600).call(zoom.transform, t);
    }

    requestRender();
  }

  // ---------- Painel ----------
  function renderStats() {
    const pos = S.edges.filter((e) => e.type === "pos");
    const neg = S.edges.filter((e) => e.type === "neg");
    const sum = (arr) => arr.reduce((s, e) => s + e.items.length, 0);
    $("stats").innerHTML = `
      <div class="stat"><b>${S.nodes.length}</b><span>Candidatos</span></div>
      <div class="stat"><b>${S.edges.length}</b><span>Setas visíveis</span></div>
      <div class="stat pos"><b>${sum(pos)}</b><span>Menções positivas</span></div>
      <div class="stat neg"><b>${sum(neg)}</b><span>Menções negativas</span></div>`;
  }

  function renderChips() {
    const wrap = $("cat-chips");
    wrap.innerHTML = "";
    S.categories.forEach((c, i) => {
      const b = document.createElement("button");
      b.type = "button";
      b.id = `cat-chip-${i}`;
      b.className = "chip-btn" + (S.activeCats.has(c) ? " active" : "");
      b.textContent = c;
      b.onclick = () => {
        if (S.activeCats.has(c)) S.activeCats.delete(c);
        else S.activeCats.add(c);
        b.classList.toggle("active");
        resetHover();
        aggregateEdges();
      };
      wrap.appendChild(b);
    });
  }

  function resetHover() {
    S.hoverEdge = null;
    S.hoverNode = null;
    S.pinned = false;
    hideTooltip();
  }

  $("toggle-pos").onclick = (ev) => {
    S.showPos = !S.showPos;
    ev.currentTarget.classList.toggle("active", S.showPos);
    resetHover();
    aggregateEdges();
  };
  $("toggle-neg").onclick = (ev) => {
    S.showNeg = !S.showNeg;
    ev.currentTarget.classList.toggle("active", S.showNeg);
    resetHover();
    aggregateEdges();
  };

  // ---------- Busca ----------
  const searchInput = $("search-input");
  const searchPop = $("search-pop");
  const searchList = $("search-results");
  const searchClear = $("search-clear");
  const SEARCH_LIMIT = 50;
  let searchHits = [], searchIdx = -1;

  const tokenize = (q) => norm(q).split(" ").filter(Boolean);

  // Todas as palavras precisam aparecer (sem acento, sem caixa); prioriza início de nome/palavra
  function matchNodes(tokens) {
    const out = [];
    for (const n of S.nodes) {
      let score = 0;
      for (const t of tokens) {
        const i = n.key.indexOf(t);
        if (i === -1) { score = -1; break; }
        score += i === 0 ? 0 : n.key[i - 1] === " " ? 1 : 3;
      }
      if (score >= 0) out.push({ n, score });
    }
    out.sort((a, b) => a.score - b.score || a.n.name.localeCompare(b.n.name, "pt-BR"));
    return out.map((o) => o.n);
  }

  // Destaca os trechos encontrados preservando acentos do nome original
  function highlightName(name, tokens) {
    let flat = "";
    const map = [];
    for (let i = 0; i < name.length; i++) {
      for (const ch of name[i].normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase()) {
        flat += ch;
        map.push(i);
      }
    }
    const mark = new Array(name.length).fill(false);
    for (const t of tokens) {
      const i = flat.indexOf(t);
      if (i >= 0) for (let j = i; j < i + t.length; j++) mark[map[j]] = true;
    }
    let html = "", open = false;
    for (let i = 0; i < name.length; i++) {
      if (mark[i] !== open) { html += mark[i] ? "<mark>" : "</mark>"; open = mark[i]; }
      html += esc(name[i]);
    }
    return open ? html + "</mark>" : html;
  }

  function openResults() {
    searchPop.classList.remove("hidden");
    searchInput.setAttribute("aria-expanded", "true");
  }
  function closeResults() {
    searchPop.classList.add("hidden");
    searchInput.setAttribute("aria-expanded", "false");
    searchInput.removeAttribute("aria-activedescendant");
    if (S.previewNode) { S.previewNode = null; requestRender(); }
  }

  function renderResults() {
    const tokens = tokenize(searchInput.value);
    searchClear.hidden = !searchInput.value;
    S.previewNode = null;
    if (!tokens.length) {
      searchHits = [];
      S.searchSet = null;
      closeResults();
      requestRender();
      return;
    }
    searchHits = matchNodes(tokens);
    S.searchSet = new Set(searchHits);
    searchIdx = searchHits.length ? 0 : -1;
    const shown = searchHits.slice(0, SEARCH_LIMIT);
    searchList.innerHTML = shown.length
      ? shown
          .map(
            (n, i) => `<li role="option" id="sr-${i}" data-i="${i}" class="sr-item${i === 0 ? " active" : ""}" aria-selected="${i === 0}">
              <span class="sr-name">${highlightName(n.name, tokens)}</span>
              <span class="sr-counts" title="Menções recebidas"><span class="pos">+${n.recvPos}</span><span class="neg">−${n.recvNeg}</span></span>
            </li>`
          )
          .join("") + (searchHits.length > SEARCH_LIMIT ? `<li class="sr-note">+${searchHits.length - SEARCH_LIMIT} — refine a busca</li>` : "")
      : `<li class="sr-note">Nenhum candidato encontrado</li>`;
    $("search-count").textContent = `${searchHits.length} ${searchHits.length === 1 ? "resultado" : "resultados"}`;
    searchList.scrollTop = 0;
    openResults();
    requestRender();
  }

  function setActive(i, { scroll = true, preview = true } = {}) {
    const items = searchList.querySelectorAll(".sr-item");
    if (!items.length) return;
    searchIdx = (i + items.length) % items.length;
    items.forEach((el, j) => {
      el.classList.toggle("active", j === searchIdx);
      el.setAttribute("aria-selected", String(j === searchIdx));
    });
    if (scroll) items[searchIdx].scrollIntoView({ block: "nearest" });
    searchInput.setAttribute("aria-activedescendant", items[searchIdx].id);
    if (preview) { S.previewNode = searchHits[searchIdx]; requestRender(); }
  }

  function selectHit(n) {
    if (!n) return;
    searchInput.value = n.name;
    searchClear.hidden = false;
    S.searchSet = null;
    closeResults();
    resetHover();
    setFocus(n);
    searchInput.blur();
  }

  function clearSearch() {
    searchInput.value = "";
    searchHits = [];
    S.searchSet = null;
    searchClear.hidden = true;
    closeResults();
    setFocus(null);
  }

  searchInput.addEventListener("input", renderResults);
  searchInput.addEventListener("focus", () => { if (searchInput.value) renderResults(); });
  searchInput.addEventListener("blur", closeResults);
  searchInput.addEventListener("keydown", (e) => {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      if (searchPop.classList.contains("hidden")) renderResults();
      else setActive(searchIdx + (e.key === "ArrowDown" ? 1 : -1));
    } else if (e.key === "Enter") {
      e.preventDefault();
      selectHit(searchHits[Math.max(0, searchIdx)]);
    } else if (e.key === "Escape") {
      e.preventDefault();
      if (searchInput.value) clearSearch();
      else searchInput.blur();
    }
  });
  searchClear.addEventListener("click", () => { clearSearch(); searchInput.focus(); });
  // mousedown + preventDefault: clicar num resultado não tira o foco do campo antes do click
  searchPop.addEventListener("mousedown", (e) => e.preventDefault());
  searchList.addEventListener("click", (e) => {
    const li = e.target.closest(".sr-item");
    if (li) selectHit(searchHits[+li.dataset.i]);
  });
  searchList.addEventListener("mouseover", (e) => {
    const li = e.target.closest(".sr-item");
    if (li && +li.dataset.i !== searchIdx) setActive(+li.dataset.i, { scroll: false });
    else if (li && !S.previewNode) setActive(searchIdx, { scroll: false });
  });
  searchList.addEventListener("mouseleave", () => { S.previewNode = null; requestRender(); });

  // ---------- Tabela de Classificação ----------
  const rankingModal = $("ranking-modal");
  const rmProfileSelect = $("rm-profile-select");
  const rmSearchInput = $("rm-search-input");
  const rmTbody = $("rm-tbody");
  const rmSummary = $("rm-summary");

  let rmSortKey = "net";
  let rmSortDir = "desc";
  let rmTypeFilter = "all"; // 'all' | 'pos' | 'neg'

  function openRankingModal() {
    if (!S.nodes.length) return;
    rankingModal.classList.remove("hidden");
    renderRanking();
    setTimeout(() => rmSearchInput.focus(), 60);
  }

  function closeRankingModal() {
    rankingModal.classList.add("hidden");
  }

  function computeRankingData(profile = "all", typeFilter = "all", search = "") {
    const q = norm(search);
    const candidateStats = new Map();
    const useWeights = S.rankingCalcMode === "weighted" && S.weightsEnabled;

    for (const n of S.nodes) {
      candidateStats.set(n.id, {
        node: n,
        pos: 0,
        neg: 0,
        net: 0,
        total: 0,
        ratio: 0,
      });
    }

    // Filtrar menções pelo perfil selecionado
    for (const m of S.mentions) {
      if (profile !== "all" && m.attr !== profile) continue;
      const stat = candidateStats.get(m.tgt);
      if (!stat) continue;
      const w = useWeights ? (m.weight ?? 1.0) : 1.0;
      if (m.type === "pos") stat.pos += w;
      else if (m.type === "neg") stat.neg += w;
    }

    // Calcular saldos e taxas
    let list = Array.from(candidateStats.values());
    list.forEach((st) => {
      st.pos = useWeights ? Math.round(st.pos * 10) / 10 : Math.round(st.pos);
      st.neg = useWeights ? Math.round(st.neg * 10) / 10 : Math.round(st.neg);
      st.net = useWeights ? Math.round((st.pos - st.neg) * 10) / 10 : st.pos - st.neg;
      st.total = st.pos + st.neg;
      st.ratio = st.total > 0 ? Math.round((st.pos / st.total) * 100) : 0;
    });

    // Filtro por busca de nome ou código
    if (q) {
      list = list.filter((st) => st.node.key.includes(q));
    }

    // Filtro por tipo
    if (typeFilter === "pos") {
      list = list.filter((st) => st.pos > 0);
    } else if (typeFilter === "neg") {
      list = list.filter((st) => st.neg > 0);
    }

    // Ordenação
    list.sort((a, b) => {
      let diff = 0;
      if (rmSortKey === "name") {
        diff = a.node.name.localeCompare(b.node.name, "pt-BR");
      } else if (rmSortKey === "pos") {
        diff = a.pos - b.pos || a.net - b.net;
      } else if (rmSortKey === "neg") {
        diff = a.neg - b.neg || b.net - a.net;
      } else { // 'net'
        diff = a.net - b.net || a.pos - b.pos;
      }
      return rmSortDir === "desc" ? -diff : diff;
    });

    return list;
  }

  function renderRanking() {
    if (!S.nodes.length) return;
    const profile = rmProfileSelect ? rmProfileSelect.value : "all";
    const search = rmSearchInput ? rmSearchInput.value : "";
    const data = computeRankingData(profile, rmTypeFilter, search);
    const useWeights = S.rankingCalcMode === "weighted" && S.weightsEnabled;

    if (rmSummary) {
      const modeText = useWeights ? "ponderado por reputação do avaliador" : "contagem bruta";
      rmSummary.textContent = `${data.length} candidatos listados (${modeText})${profile !== "all" ? ` no perfil "${profile}"` : " no geral"}`;
    }

    if (!data.length) {
      rmTbody.innerHTML = `<tr><td colspan="8" class="sr-note" style="text-align:center;padding:28px;">Nenhum candidato encontrado com os filtros selecionados.</td></tr>`;
      return;
    }

    const star = useWeights ? "★" : "";
    rmTbody.innerHTML = data
      .map((item, idx) => {
        const rank = idx + 1;
        const isFocused = S.focusNode === item.node;
        const rankBadge =
          rank === 1 ? `<span class="rank-badge top-1">🥇</span>` :
          rank === 2 ? `<span class="rank-badge top-2">🥈</span>` :
          rank === 3 ? `<span class="rank-badge top-3">🥉</span>` :
          `#${rank}`;

        const netClass = item.net > 0 ? "pos" : item.net < 0 ? "neg" : "zero";
        const netSign = item.net > 0 ? `+${item.net}${star}` : `${item.net}${star}`;
        const posText = `+${item.pos}${star}`;
        const negText = `−${item.neg}${star}`;

        return `
          <tr class="rm-tr${isFocused ? " active-focus" : ""}" data-id="${esc(item.node.id)}">
            <td class="td-rank">${rankBadge}</td>
            <td class="td-photo">
              ${(() => {
                const words = (item.node.name || "").trim().split(/\s+/).filter(Boolean);
                const initials = words.length > 1 ? (words[0][0] + words[words.length - 1][0]).toUpperCase() : (words[0] ? words[0].slice(0, 2).toUpperCase() : "?");
                return item.node.photo
                  ? `<div class="rm-avatar-wrap"><img src="${item.node.photo}" class="rm-avatar" onerror="this.onerror=null;this.parentElement.innerHTML='<span class=\\'rm-avatar-fallback\\'>${initials}</span>';" /></div>`
                  : `<div class="rm-avatar-wrap"><span class="rm-avatar-fallback">${initials}</span></div>`;
              })()}
            </td>
            <td class="td-name">
              <strong>${esc(item.node.name)}</strong>
              <small>${esc(item.node.id !== item.node.name ? item.node.id : "")}</small>
            </td>
            <td class="td-num"><span class="pill-pos">${posText}</span></td>
            <td class="td-num"><span class="pill-neg">${negText}</span></td>
            <td class="td-num"><span class="pill-net ${netClass}">${netSign}</span></td>
            <td class="td-bar">
              <div class="ratio-bar-wrap">
                <div class="ratio-track">
                  <div class="ratio-fill" style="width:${item.ratio}%"></div>
                </div>
                <span>${item.ratio}%</span>
              </div>
            </td>
            <td class="td-action">
              <button class="btn-focus-row" type="button" title="Ver no Grafo">Focar no Grafo ↗</button>
            </td>
          </tr>
        `;
      })
      .join("");
  }

  // Controles de Configurações do Grafo (Modo de cor, pesos, slider)
  const nodeColorModeBtns = document.querySelectorAll("#node-color-mode .seg-btn");
  nodeColorModeBtns.forEach((btn) => {
    btn.onclick = () => {
      const mode = btn.dataset.mode;
      S.nodeColorMode = mode;
      nodeColorModeBtns.forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      const legend = $("color-scale-legend");
      if (legend) legend.style.display = mode === "default" ? "none" : "flex";
      requestRender();
    };
  });

  const weightsToggle = $("weights-toggle");
  const weightSlider = $("weight-intensity-slider");
  const weightVal = $("weight-intensity-val");
  const showWeightsEdges = $("show-weights-on-edges");
  const weightsControls = $("weights-controls");

  if (weightsToggle) {
    weightsToggle.onchange = () => {
      S.weightsEnabled = weightsToggle.checked;
      if (weightsControls) weightsControls.style.opacity = S.weightsEnabled ? "1" : "0.4";
      if (weightsControls) weightsControls.style.pointerEvents = S.weightsEnabled ? "auto" : "none";
      recalculateWeights();
      renderStats();
      renderRanking();
      requestRender();
    };
  }

  if (weightSlider) {
    weightSlider.oninput = () => {
      const v = parseFloat(weightSlider.value);
      S.weightIntensity = v;
      if (weightVal) weightVal.textContent = `${v.toFixed(1)}x`;
      recalculateWeights();
      renderRanking();
      requestRender();
    };
  }

  if (showWeightsEdges) {
    showWeightsEdges.onchange = () => {
      S.showWeightsOnEdges = showWeightsEdges.checked;
      requestRender();
    };
  }

  // Toggles de modo de cálculo de ranking (Com pesos vs Bruto)
  const rmCalcWeighted = $("rm-calc-weighted");
  const rmCalcRaw = $("rm-calc-raw");
  if (rmCalcWeighted && rmCalcRaw) {
    rmCalcWeighted.onclick = () => {
      S.rankingCalcMode = "weighted";
      rmCalcWeighted.classList.add("active");
      rmCalcRaw.classList.remove("active");
      renderRanking();
    };
    rmCalcRaw.onclick = () => {
      S.rankingCalcMode = "raw";
      rmCalcRaw.classList.add("active");
      rmCalcWeighted.classList.remove("active");
      renderRanking();
    };
  }

  if ($("btn-open-ranking")) $("btn-open-ranking").onclick = openRankingModal;
  if ($("top-btn-ranking")) $("top-btn-ranking").onclick = openRankingModal;
  if ($("rm-close")) $("rm-close").onclick = closeRankingModal;
  if ($("rm-backdrop")) $("rm-backdrop").onclick = closeRankingModal;

  if (rmProfileSelect) rmProfileSelect.addEventListener("change", renderRanking);
  if (rmSearchInput) rmSearchInput.addEventListener("input", renderRanking);

  const rmTypeBtns = {
    all: $("rm-type-all"),
    pos: $("rm-type-pos"),
    neg: $("rm-type-neg"),
  };
  Object.entries(rmTypeBtns).forEach(([key, btn]) => {
    if (!btn) return;
    btn.onclick = () => {
      rmTypeFilter = key;
      Object.values(rmTypeBtns).forEach((b) => b && b.classList.remove("active"));
      btn.classList.add("active");
      renderRanking();
    };
  });

  document.querySelectorAll(".rm-table th[data-sort]").forEach((th) => {
    th.onclick = () => {
      const key = th.dataset.sort;
      if (rmSortKey === key) {
        rmSortDir = rmSortDir === "desc" ? "asc" : "desc";
      } else {
        rmSortKey = key;
        rmSortDir = key === "name" ? "asc" : "desc";
      }
      document.querySelectorAll(".rm-table th .sort-arr").forEach((span) => {
        span.classList.remove("active");
        span.textContent = "↕";
      });
      const arr = th.querySelector(".sort-arr");
      if (arr) {
        arr.classList.add("active");
        arr.textContent = rmSortDir === "desc" ? "↓" : "↑";
      }
      renderRanking();
    };
  });

  if (rmTbody) {
    rmTbody.addEventListener("click", (e) => {
      const tr = e.target.closest(".rm-tr");
      if (!tr) return;
      const id = tr.dataset.id;
      const n = S.nodeById.get(id);
      if (n) {
        closeRankingModal();
        setFocus(n);
      }
    });
  }

  $("zoom-in").onclick = () => d3.select(canvas).transition().duration(250).call(zoom.scaleBy, 1.4);
  $("zoom-out").onclick = () => d3.select(canvas).transition().duration(250).call(zoom.scaleBy, 1 / 1.4);
  $("zoom-fit").onclick = () => fitView();
  $("export-png").onclick = () => {
    const out = document.createElement("canvas");
    out.width = canvas.width;
    out.height = canvas.height;
    const o = out.getContext("2d");
    o.fillStyle = "#0b0e17";
    o.fillRect(0, 0, out.width, out.height);
    o.drawImage(canvas, 0, 0);
    const a = document.createElement("a");
    a.download = "grafo-mencoes.png";
    a.href = out.toDataURL("image/png");
    a.click();
  };

  // ---------- Carregamento ----------
  function loadText(text, fileName) {
    let data;
    try {
      data = buildData(text);
    } catch (err) {
      $("dz-error").textContent = err.message;
      if (S.nodes.length) alert(err.message);
      return;
    }
    $("dz-error").textContent = "";
    if (S.sim) S.sim.stop();
    resetHover();
    setFocus(null);

    Object.assign(S, data);
    S.activeCats = new Set(S.categories);
    S.showPos = S.showNeg = true;
    $("toggle-pos").classList.add("active");
    $("toggle-neg").classList.add("active");
    $("file-name").textContent = fileName;
    searchInput.value = "";
    searchHits = [];
    S.searchSet = null;
    S.previewNode = null;
    searchClear.hidden = true;
    closeResults();

    $("dropzone").classList.add("hidden");
    $("panel").classList.remove("hidden");
    $("controls").classList.remove("hidden");
    if ($("top-nav")) $("top-nav").classList.remove("hidden");

    renderChips();
    aggregateEdges();

    const maxW = d3.max(S.pairLinks, (l) => l.w) || 1;
    S.sim = d3
      .forceSimulation(S.nodes)
      .force("link", d3.forceLink(S.pairLinks).id((d) => d.id).distance(110).strength((l) => 0.08 + 0.25 * (l.w / maxW)))
      .force("charge", d3.forceManyBody().strength(-320).distanceMax(900))
      .force("collide", d3.forceCollide().radius((d) => d.r + 16))
      .force("x", d3.forceX().strength(0.04))
      .force("y", d3.forceY().strength(0.04))
      .stop();
    S.sim.tick(220);

    // Gravar posições naturais/originais de todos os nós após o layout da simulação
    for (const node of S.nodes) {
      node.homeX = node.x;
      node.homeY = node.y;
    }

    S.sim.alpha(0.08).on("tick", () => {
      // Atualizar posições home enquanto a simulação desacelera
      for (const node of S.nodes) {
        if (!S.focusNode) {
          node.homeX = node.x;
          node.homeY = node.y;
        }
      }
      requestRender();
    }).restart();

    resize();
    fitView(0);
  }

  function readFile(file) {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      let text = reader.result;
      // Fallback para arquivos em Latin-1/Windows-1252 (Excel)
      if (text.includes("\uFFFD")) {
        const r2 = new FileReader();
        r2.onload = () => loadText(r2.result, file.name);
        r2.readAsText(file, "windows-1252");
        return;
      }
      loadText(text, file.name);
    };
    reader.readAsText(file, "utf-8");
  }

  fileInput.addEventListener("change", () => {
    readFile(fileInput.files[0]);
    fileInput.value = "";
  });

  // Drag & drop em qualquer lugar da tela
  let dragDepth = 0;
  const overlay = $("drag-overlay");
  window.addEventListener("dragenter", (e) => { e.preventDefault(); dragDepth++; overlay.classList.add("show"); });
  window.addEventListener("dragleave", () => { if (--dragDepth <= 0) { dragDepth = 0; overlay.classList.remove("show"); } });
  window.addEventListener("dragover", (e) => e.preventDefault());
  window.addEventListener("drop", (e) => {
    e.preventDefault();
    dragDepth = 0;
    overlay.classList.remove("show");
    readFile(e.dataTransfer.files[0]);
  });

  window.addEventListener("resize", resize);
  window.addEventListener("keydown", (e) => {
    const typing = e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement;
    const ready = !$("panel").classList.contains("hidden");

    if (e.key === "Escape") {
      if (rankingModal && !rankingModal.classList.contains("hidden")) {
        closeRankingModal();
        return;
      }
      if (!typing) {
        unpin();
        setFocus(null);
      }
      return;
    }

    // Atalhos: "/" ou ⌘K / Ctrl+K focam a busca
    if (ready && ((e.key === "/" && !typing) || ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k"))) {
      e.preventDefault();
      searchInput.focus();
      searchInput.select();
      return;
    }
  });
  resize();

  // Carregamento opcional via URL (?csv=arquivo.csv) quando servido por HTTP
  const qs = new URLSearchParams(location.search).get("csv");
  if (qs) {
    fetch(qs).then((r) => r.text()).then((t) => loadText(t, qs)).catch(() => {});
  } else {
    // Tenta carregar automaticamente mencoes_candidatos.csv se estiver disponível no servidor
    fetch("mencoes_candidatos.csv")
      .then((r) => (r.ok ? r.text() : Promise.reject()))
      .then((t) => loadText(t, "mencoes_candidatos.csv"))
      .catch(() => {});
  }
})();
