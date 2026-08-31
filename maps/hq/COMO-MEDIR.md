# Como medir o HQ sem mentir

Quatro falhas de verificacao numa unica sessao (31/08/2026) tiveram a MESMA raiz:
a foto foi tirada sem antes provar que o comando tinha rodado.

## A raiz

`WA` NAO existe na pagina do jogo. Ele so existe dentro do iframe do script
(`quest.html`). `page.evaluate(() => WA.player.moveTo(...))` na pagina host devolve
undefined em silencio: o avatar nunca anda, a camera nunca muda, e as fotos saem todas
iguais - parecendo que o mundo esta quebrado quando so o comando nao chegou.

## O gesto obrigatorio, antes de qualquer bateria de screenshot

```js
const alvo = page.frames().find(f => f.url().includes('quest.html'));
assert(alvo, 'frame do script nao existe - a medicao nao vale');
const vivo = await alvo.evaluate(() => typeof WA !== 'undefined' && !!WA.player);
assert(vivo, 'WA ausente no frame - comando nao roda, foto nao prova nada');
```

Só depois disso: `alvo.evaluate(...)` para mover, pintar ou ler estado.

## As outras tres armadilhas ja pagas

1. **Cache do tileset.** O navegador serve o PNG velho e o desenho novo nunca aparece.
   Trocar o NOME do arquivo (`HQ_Marcadores_v2.png`) e conferir com
   `curl -s -o /tmp/x.png <url> && md5sum /tmp/x.png <arquivo-no-disco>`.
2. **Fotografar o objeto errado.** O mapa tem decoracao redonda e ciana propria (lirios
   dagua do WA_Exterior). Antes de julgar um marcador, PINTE ele numa posicao conhecida
   e fotografe ali - nunca cace na paisagem.
3. **Console nao e tela.** `[TOUR] parada 3` prova que a funcao rodou, nunca que o balao
   e legivel. Popup herda a LARGURA do objeto ancora: ancora de 32px espreme o texto em
   coluna vertical. Toda entrega visual passa por screenshot lido.

## Camadas tecnicas

`collisions` e `start` usam tiles do WA_Special_Zones, que sao ANOTACAO DE EDITOR e
desenham as palavras "BLOCK", "URL", "ZONE" no chao. Elas nascem `visible: true` no
map-starter-kit. Mantenha `visible: false`.
