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
  })
  .catch(function (erro) {
    console.error("[COMERCIAL] falha ao iniciar", erro);
  });
