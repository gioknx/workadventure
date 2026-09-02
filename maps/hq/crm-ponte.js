/**
 * Ponte do CRM — reacoes leves dos eventos vindos do funil.
 *
 * Regra: evento de alto volume NUNCA vira som. Nenhum dos 11 eventos abaixo
 * toca audio. O unico evento sonoro da ponte e matricula_view, que chega como
 * "hq-venda" e ja e tratado pelo sino-global.js — este arquivo nao o escuta.
 */

const CRM_EVENTOS = [
  "quiz_view",
  "quiz_start",
  "quiz_step_answered",
  "quiz_complete",
  "resultado_view",
  "resultado_cta_click",
  "onboarding_in_progress",
  "onboarding_completed",
  "pre_task_awaiting_review",
  "first_job_approved",
  "first_job_rejected",
];

WA.onInit()
  .then(function () {
    CRM_EVENTOS.forEach(function (nome) {
      WA.event.on("crm-" + nome).subscribe(function (evento) {
        const dados = (evento && (evento.data || evento.value)) || {};
        const quem = dados.actorLabel || "Candidata";
        console.info("[CRM-PONTE] " + nome + " · " + quem);
        if (nome !== "first_job_approved") return;
        WA.ui.banner.openBanner({
          id: "crm-first-job",
          text: "⭐ PRIMEIRO JOB APROVADO · " + quem,
          bgColor: "#8A6D1D",
          textColor: "#ffffff",
          closable: true,
          timeToClose: 8000,
        });
      });
    });

    console.info("[CRM-PONTE] ponte do CRM pronta · " + CRM_EVENTOS.length + " eventos");
  })
  .catch(function (erro) {
    console.error("[CRM-PONTE] falha ao iniciar", erro);
  });
