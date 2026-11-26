"""Encode runtime art as WebP without changing size, framing, or alpha."""
from pathlib import Path
from PIL import Image
root=Path(__file__).resolve().parents[2]
assets=root/'src/assets/card-table'
chosen=['celestial-back-v1','celestial-frame-v1','celestial-table-v1','celestial-phone-v1','scrying-orb-still-v1','deck-movies-still-v1','deck-shows-still-v1']
for name in chosen:
    original=assets/(name+'.png')
    if not original.exists(): continue
    with Image.open(original) as im:
        im.save(assets/(name+'.webp'),'WEBP',quality=88,method=6,exact=True)
    original.unlink()
for file in (root/'src').rglob('*'):
    if file.suffix in {'.ts','.tsx','.css'}:
        text=file.read_text(encoding='utf-8')
        for name in chosen:text=text.replace(name+'.png',name+'.webp')
        file.write_text(text,encoding='utf-8') if text!=file.read_text(encoding='utf-8') else None
print('Runtime art encoded:',sum((assets/(name+'.webp')).stat().st_size for name in chosen),'bytes')
