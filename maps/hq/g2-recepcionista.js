/**
 * Recepcionista do HQ - walkthrough guiado.
 *
 * Existe porque as experiencias do mundo eram invisiveis: o avatar andava,
 * um aviso aparecia do nada e nao havia placa dizendo o que tinha ali.
 * A recepcionista leva o visitante ate cada lugar e explica na frente dele.
 *
 * Nao usa o proxy de LLM (porta 8899) - os textos sao fixos; o NPC de chat
 * do quest.js continua sendo o que conversa.
 */
WA.onInit().then(function () {
  var PARADAS = [
    { n: 0, nome: "Recepcao", x: 9, y: 17,
      texto: "Oi! Sou a recepcionista do HQ. Este mundo reage a voce - quer que eu te mostre? O passeio leva 2 minutos." },
    { n: 1, nome: "Mesa dos agentes", x: 25, y: 8,
      texto: "Esta mesa e ocupada pelas IAs que estao trabalhando AGORA nas suas abas. Cada cadeira e um agente real, com o projeto e a tarefa dele." },
    { n: 2, nome: "Estantes do musgo", x: 22, y: 17,
      texto: "Biblioteca. Nota do seu Vault parada ha 21+ dias cobre a estante de musgo. Pisar na estante limpa o musgo e mostra qual nota esta dormindo." },
    { n: 3, nome: "Bola do corredor", x: 17, y: 17,
      texto: "Esta bola rola quando alguem esbarra nela, e a posicao vale para todo mundo. Onde ela dormir vira o ponto de encontro do dia, marcado no chao." },
    { n: 4, nome: "Sala de lazer", x: 20, y: 18,
      texto: "Entrar aqui joga uma partida. Quem ganha sai soltando confete pelo mapa por 20 minutos." },
    { n: 5, nome: "Sinuca fantasma", x: 23, y: 19,
      texto: "A mesa lembra a posicao das bolas e quem deu a ultima tacada - mesmo com a sala vazia por dias." },
    { n: 6, nome: "Objeto do dia", x: 26, y: 19,
      texto: "O pedestal sorteia um objeto novo a cada dia. Hoje ja tem um - encoste para ver." },
    { n: 7, nome: "Fita cassete", x: 27, y: 19,
      texto: "O gravador guarda os ultimos passos de quem esteve aqui. Entre, ande, saia e volte: seu fantasma refaz o caminho." }
  ];

  var popup = null;
  var andando = false;
  var timerAuto = null;

  function fechar() {
    if (popup) { try { popup.close(); } catch (e) {} popup = null; }
    if (timerAuto) { clearTimeout(timerAuto); timerAuto = null; }
  }

  function auto() {
    return WA.player.state.hq_tour_auto === true;
  }

  function abrir(ancora, texto, botoes) {
    fechar();
    popup = WA.ui.openPopup(ancora, texto, botoes);
  }

  // Leva o avatar ate a parada e abre a placa dela.
  function ir(indice) {
    if (indice >= PARADAS.length) { encerrar(); return; }
    var p = PARADAS[indice];
    fechar();
    andando = true;
    WA.player.moveTo(p.x * 32 + 16, p.y * 32 + 16, 12).then(function (r) {
      andando = false;
      if (r && r.cancelled) { console.warn("[TOUR] caminho cancelado na parada", p.n); }
      console.info("[TOUR] parada " + p.n + ": " + p.nome);
      var ultima = indice === PARADAS.length - 1;
      abrir("tour-" + p.n, p.texto, [
        { label: ultima ? "Terminar" : "Proxima", className: "primary", callback: function () { ir(indice + 1); } },
        { label: "Parar aqui", className: "normal", callback: function () { fechar(); } }
      ]);
      if (auto()) { timerAuto = setTimeout(function () { ir(indice + 1); }, 2500); }
    }).catch(function (e) {
      andando = false;
      console.error("[TOUR] falhou ao andar ate a parada " + p.n, e);
      if (auto()) { timerAuto = setTimeout(function () { ir(indice + 1); }, 2500); }
    });
  }

  function encerrar() {
    fechar();
    WA.player.state.hq_tour_feito = true;
    console.info("[TOUR] terminado");
    popup = WA.ui.openPopup("tour-7",
      "Fim do passeio. Tudo isso fica ligado o tempo todo - agora anda por ai.",
      [{ label: "Valeu", className: "primary", callback: function () { fechar(); } }]);
    if (auto()) { timerAuto = setTimeout(fechar, 2500); }
  }

  function convidar() {
    if (andando) return;
    var feito = WA.player.state.hq_tour_feito === true;
    if (!feito && WA.player.state.hq_tour_pausado === true) return;
    abrir("tour-0", feito
      ? "De novo por aqui? Posso refazer o passeio quando voce quiser."
      : PARADAS[0].texto,
      [
        { label: feito ? "Rever o tour" : "Fazer o tour", className: "primary", callback: function () { ir(0); } },
        { label: feito ? "Fechar" : "Agora nao", className: "normal",
          callback: function () { WA.player.state.hq_tour_pausado = true; fechar(); } }
      ]);
  }

  WA.room.area.onEnter("NPC").subscribe(convidar);
  WA.room.area.onLeave("NPC").subscribe(function () { if (!andando) fechar(); });

  if (auto()) { console.info("[TOUR] modo automatico"); ir(0); }

  console.info("[G2] recepcionista carregada");
}).catch(function (e) { console.error("[G2] recepcionista erro", e); });
