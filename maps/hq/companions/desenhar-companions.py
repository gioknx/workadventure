#!/usr/bin/env python3
"""Desenha as folhas de companion do HQ em 32px nativo.

Formato medido no clone (nada aqui e' redimensionado):
  play/src/front/Phaser/Companion/CompanionTexturesLoadingManager.ts:69
    load.spritesheet(id, url, { frameWidth: 32, frameHeight: 32 })
  play/src/front/Phaser/Companion/Companion.ts:171-221
    frames 0,1,2 = down · 3,4,5 = left · 6,7,8 = right · 9,10,11 = up
    idle usa o frame do meio de cada linha (1, 4, 7, 10)
  => folha de 3 colunas x 4 linhas = 96x128 px, igual aos exemplos
     play/public/resources/characters/pipoya/Cat 01-1.png (96x128).

Arte DESENHADA aqui: nenhum pack comprado tem bicho top-down de 4 direcoes
em 32px nativo (fantasy-battlers e' 48x48 de perfil; os packs de escritorio
nao tem animal). Redimensionar 48->32 e' escala fracionaria, proibida pela
regra do projeto.
"""

from PIL import Image, ImageDraw

CELULA = 32
COLUNAS = 3
LINHAS = 4

BICHOS = {
    "gato": {
        "corpo": (125, 135, 148, 255),
        "claro": (185, 194, 205, 255),
        "traco": (43, 47, 56, 255),
        "olho": (241, 199, 91, 255),
        "detalhe": (241, 199, 91, 255),
    },
    "cachorro": {
        "corpo": (181, 122, 60, 255),
        "claro": (226, 181, 122, 255),
        "traco": (58, 36, 18, 255),
        "olho": (27, 20, 16, 255),
        "detalhe": (102, 211, 154, 255),
    },
    "dragao": {
        "corpo": (63, 174, 122, 255),
        "claro": (102, 211, 154, 255),
        "traco": (23, 64, 47, 255),
        "olho": (241, 199, 91, 255),
        "detalhe": (241, 199, 91, 255),
    },
}

# fase 0 e 2 sao os passos; fase 1 e' a parada (frame idle)
PASSO = {0: (-1, 1), 1: (0, 0), 2: (1, -1)}


def frente(d, c, especie, fase, costas):
    a, b = PASSO[fase]
    # rabo atras do corpo
    if costas:
        d.ellipse((14, 16, 18, 30), fill=c["claro"], outline=c["traco"])
    else:
        d.ellipse((22, 18, 26, 26), fill=c["corpo"], outline=c["traco"])
    # patas
    d.rectangle((10, 26 + a, 13, 29 + a), fill=c["claro"], outline=c["traco"])
    d.rectangle((19, 26 + b, 22, 29 + b), fill=c["claro"], outline=c["traco"])
    # corpo
    d.ellipse((9, 16, 23, 28), fill=c["corpo"], outline=c["traco"])
    if not costas:
        d.ellipse((13, 20, 19, 27), fill=c["claro"])
    # orelhas / asas / chifres
    if especie == "dragao":
        d.polygon([(4, 14), (9, 8), (10, 18)], fill=c["claro"], outline=c["traco"])
        d.polygon([(28, 14), (23, 8), (22, 18)], fill=c["claro"], outline=c["traco"])
        d.polygon([(11, 7), (13, 2), (14, 8)], fill=c["detalhe"], outline=c["traco"])
        d.polygon([(21, 7), (19, 2), (18, 8)], fill=c["detalhe"], outline=c["traco"])
    elif especie == "gato":
        d.polygon([(9, 10), (11, 3), (15, 9)], fill=c["corpo"], outline=c["traco"])
        d.polygon([(23, 10), (21, 3), (17, 9)], fill=c["corpo"], outline=c["traco"])
    else:
        d.ellipse((6, 7, 12, 17), fill=c["traco"])
        d.ellipse((20, 7, 26, 17), fill=c["traco"])
    # cabeca
    d.ellipse((8, 6, 24, 20), fill=c["corpo"], outline=c["traco"])
    if costas:
        return
    d.ellipse((12, 13, 20, 19), fill=c["claro"])
    d.rectangle((12, 11, 13, 12), fill=c["olho"])
    d.rectangle((18, 11, 19, 12), fill=c["olho"])
    d.rectangle((15, 14, 16, 15), fill=c["traco"])
    if especie == "cachorro":
        d.rectangle((10, 20, 22, 22), fill=c["detalhe"], outline=c["traco"])


def perfil(d, c, especie, fase):
    a, b = PASSO[fase]
    # rabo
    if especie == "gato":
        d.line((23, 22, 27, 12), fill=c["corpo"], width=2)
    elif especie == "cachorro":
        d.line((23, 21, 27, 15), fill=c["claro"], width=3)
    else:
        d.line((23, 22, 29, 18), fill=c["corpo"], width=3)
        d.polygon([(27, 14), (31, 18), (27, 22)], fill=c["detalhe"], outline=c["traco"])
    # patas
    d.rectangle((11, 24 + a, 13, 29 + a), fill=c["claro"], outline=c["traco"])
    d.rectangle((19, 24 + b, 21, 29 + b), fill=c["claro"], outline=c["traco"])
    # corpo
    d.ellipse((8, 14, 25, 26), fill=c["corpo"], outline=c["traco"])
    d.ellipse((11, 20, 21, 25), fill=c["claro"])
    if especie == "dragao":
        d.polygon([(13, 15), (18, 6), (23, 15)], fill=c["claro"], outline=c["traco"])
    # cabeca
    if especie == "gato":
        d.polygon([(5, 12), (7, 5), (11, 11)], fill=c["corpo"], outline=c["traco"])
        d.polygon([(13, 11), (12, 5), (16, 10)], fill=c["corpo"], outline=c["traco"])
    elif especie == "cachorro":
        d.ellipse((3, 9, 8, 19), fill=c["traco"])
    else:
        d.polygon([(9, 8), (12, 2), (14, 9)], fill=c["detalhe"], outline=c["traco"])
    d.ellipse((3, 8, 16, 20), fill=c["corpo"], outline=c["traco"])
    d.ellipse((2, 14, 8, 19), fill=c["claro"])
    d.rectangle((2, 15, 3, 16), fill=c["traco"])
    d.rectangle((7, 12, 8, 13), fill=c["olho"])
    if especie == "cachorro":
        d.rectangle((13, 17, 17, 19), fill=c["detalhe"], outline=c["traco"])


def quadro(especie, direcao, fase):
    c = BICHOS[especie]
    img = Image.new("RGBA", (CELULA, CELULA), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    if direcao == "down":
        frente(d, c, especie, fase, costas=False)
    elif direcao == "up":
        frente(d, c, especie, fase, costas=True)
    elif direcao == "left":
        perfil(d, c, especie, fase)
    else:
        perfil(d, c, especie, fase)
        img = img.transpose(Image.FLIP_LEFT_RIGHT)
    return img


def folha(especie):
    sheet = Image.new("RGBA", (CELULA * COLUNAS, CELULA * LINHAS), (0, 0, 0, 0))
    for linha, direcao in enumerate(["down", "left", "right", "up"]):
        for fase in range(COLUNAS):
            sheet.paste(quadro(especie, direcao, fase), (fase * CELULA, linha * CELULA))
    return sheet


if __name__ == "__main__":
    from pathlib import Path

    aqui = Path(__file__).resolve().parent
    for especie in BICHOS:
        destino = aqui / f"{especie}.png"
        folha(especie).save(destino)
        print(f"{destino} {Image.open(destino).size}")
