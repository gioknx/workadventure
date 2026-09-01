const AREAS_COMERCIAIS = [
  "sala-zeca",
  "sala-th",
  "sala-fernando",
  "sala-xyz",
  "sala-vip",
];

WA.onInit()
  .then(function () {
    console.info("[COMERCIAL] mapa carregado");
    AREAS_COMERCIAIS.forEach(function (area) {
      WA.room.area.onEnter(area).subscribe(function () {
        console.info("[COMERCIAL] entrou " + area);
      });
    });

    let placarSite = null;
    WA.room.area.onEnter("placar").subscribe(function () {
      if (placarSite) return;
      WA.ui.website.open({
        url: "http://maps.workadventure.test/hq/placar.html?v=nv1f3",
        position: { vertical: "middle", horizontal: "middle" },
        size: { height: "620px", width: "760px" },
        allowApi: false,
      }).then(function (site) {
        placarSite = site;
      });
    });
    WA.room.area.onLeave("placar").subscribe(function () {
      if (placarSite) {
        placarSite.close();
        placarSite = null;
      }
    });
  })
  .catch(function (erro) {
    console.error("[COMERCIAL] falha ao iniciar", erro);
  });
