/**
 * Grupo 2 / camada 3 — memoria entre sessoes.
 * Sinuca fantasma, objeto do dia e fita cassete da sala.
 */
WA.onInit().then(function () {
  var CAMADA = "floor/floor2";
  var TILE_SINUCA = 8;
  var TILE_PEDESTAL = 10;
  var TILE_FANTASMA = 12;
  var gravando = false;
  var ultimaFita = ler("hq_fita", null);
  var caminho = [];
  var ultimoPonto = "";
  var reproducao = null;

  function ler(chave, fallback) {
    try { return JSON.parse(WA.state[chave] || JSON.stringify(fallback)); }
    catch (e) { return fallback; }
  }

  function mostrar(id, texto) {
    WA.ui.banner.openBanner({ id: id, text: texto, closable: true, timeToClose: 8000 });
  }

  function tile(x, y, valor) {
    WA.room.setTiles([{ x: x, y: y, tile: valor, layer: CAMADA }]);
  }

  // 4. Mesa de sinuca fantasma — a posicao e o ultimo taco sobrevivem a sala vazia.
  var sinuca = ler("hq_sinuca", { bolas: [22, 23, 24], taco: "ninguem", tacadas: 0 });
  function desenharSinuca() {
    [22, 23, 24, 25].forEach(function (x) { tile(x, 19, null); });
    (sinuca.bolas || []).forEach(function (x) { tile(x, 19, TILE_SINUCA); });
  }
  desenharSinuca();
  WA.room.area.onEnter("sinuca-fantasma").subscribe(function () {
    sinuca = ler("hq_sinuca", sinuca);
    mostrar("sinuca", "Taco parado onde " + sinuca.taco + " deixou. Tacadas guardadas: " + sinuca.tacadas + ". Voce deu a proxima.");
    sinuca.bolas = (sinuca.bolas || [22, 23, 24]).map(function (x, i) {
      return 22 + ((x - 21 + i) % 4);
    });
    sinuca.taco = WA.player.name;
    sinuca.tacadas = (sinuca.tacadas || 0) + 1;
    WA.state.saveVariable("hq_sinuca", JSON.stringify(sinuca));
    desenharSinuca();
    console.info("[G2] sinuca: tacada " + sinuca.tacadas + " de " + WA.player.name);
  });
  WA.state.onVariableChange("hq_sinuca").subscribe(function () {
    sinuca = ler("hq_sinuca", sinuca);
    desenharSinuca();
  });

  // 5. Objeto do dia — a data escolhe um efeito igual para todos.
  var objetos = [
    { nome: "Chapeu do dia", efeito: "seu avatar ganhou o titulo CHAPEU por hoje" },
    { nome: "Caixa de musica", efeito: "uma musica imaginaria ocupa este raio" },
    { nome: "Trampolim", efeito: "voce atravessou a sala num salto" }
  ];
  function objetoDeHoje() {
    var dia = new Date().toISOString().slice(0, 10);
    var n = dia.split("").reduce(function (s, c) { return s + (Number(c) || 0); }, 0);
    return { dia: dia, item: objetos[n % objetos.length] };
  }
  var hoje = objetoDeHoje();
  tile(25, 19, TILE_PEDESTAL);
  WA.room.area.onEnter("objeto-do-dia").subscribe(function () {
    hoje = objetoDeHoje();
    WA.player.state.saveVariable("hq_objeto_do_dia", hoje.dia + ":" + hoje.item.nome);
    mostrar("pedestal", hoje.item.nome + " — " + hoje.item.efeito + ". Troca a meia-noite.");
    console.info("[G2] pedestal: " + hoje.item.nome + " em " + hoje.dia);
  });

  // 6. Fita cassete — grava os ultimos passos e os refaz como rastro fantasma.
  function pararReproducao() {
    clearInterval(reproducao);
    reproducao = null;
  }
  function reproduzir(fita) {
    pararReproducao();
    if (!fita || !Array.isArray(fita.caminho) || fita.caminho.length === 0) {
      mostrar("cassete", "A fita ainda esta vazia. Caminhe pela sala para deixar o primeiro fantasma.");
      return;
    }
    var i = 0;
    var anterior = null;
    mostrar("cassete", "PLAY — fantasma de " + fita.quem + ", " + fita.caminho.length + " passos guardados.");
    reproducao = setInterval(function () {
      if (anterior) tile(anterior.x, anterior.y, null);
      if (i >= fita.caminho.length) {
        pararReproducao();
        console.info("[G2] cassete: replay terminou (" + fita.caminho.length + " passos de " + fita.quem + ")");
        return;
      }
      anterior = fita.caminho[i++];
      tile(anterior.x, anterior.y, TILE_FANTASMA);
    }, 350);
  }
  WA.room.area.onEnter("fita-cassete").subscribe(function () {
    reproduzir(ultimaFita);
    gravando = true;
    caminho = [];
    ultimoPonto = "";
  });
  WA.room.area.onLeave("fita-cassete").subscribe(function () {
    gravando = false;
    pararReproducao();
    if (caminho.length > 0) {
      ultimaFita = { quem: WA.player.name, quando: Date.now(), caminho: caminho.slice(-120) };
      WA.state.saveVariable("hq_fita", JSON.stringify(ultimaFita));
      console.info("[G2] cassete: gravou " + ultimaFita.caminho.length + " passos de " + ultimaFita.quem);
    }
  });
  WA.state.onVariableChange("hq_fita").subscribe(function () {
    ultimaFita = ler("hq_fita", ultimaFita);
  });
  WA.player.onPlayerMove(function (posicao) {
    if (!gravando) return;
    var p = { x: Math.floor(posicao.x / 32), y: Math.floor(posicao.y / 32) };
    var chave = p.x + ":" + p.y;
    if (chave === ultimoPonto) return;
    ultimoPonto = chave;
    caminho.push(p);
    if (caminho.length > 120) caminho.shift();
  });

  console.info("[G2] memoria carregada: sinuca + pedestal + cassete");
}).catch(function (e) { console.error("[G2] memoria erro", e); });
