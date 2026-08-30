/**
 * Primeiro grupo - Mesa que o agente ocupa.
 * A mesa aparece na Diretoria sem alterar o arquivo do mapa: cada agente Herdr
 * presente ocupa uma cadeira; a tarefa vem do titulo vivo da pane.
 */
WA.onInit().then(async function () {
  try {
    await WA.room.website.delete("mesa-agentes");
  } catch (_) {}

  WA.room.website.create({
    name: "mesa-agentes",
    url: "http://maps.workadventure.test/hq/mesa-agentes.html?v=2",
    position: { x: 1024, y: 96, width: 256, height: 288 },
    visible: true,
    allowApi: false,
    allow: "",
    origin: "map",
    scale: 1,
  });

  console.info("[HQ] mesa dos agentes carregada");
}).catch(function (erro) {
  console.error("[HQ] mesa dos agentes erro", erro);
});
