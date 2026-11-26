"""Compile the standalone map with local projections, data, style and typefaces."""
import base64,pathlib,sys
root=pathlib.Path(__file__).resolve().parent
def font(name,file,style='normal'):
 data=base64.b64encode((root.parents[1]/'public/fonts'/file).read_bytes()).decode()
 return "@font-face{font-family:'"+name+"';font-style:"+style+";font-display:block;src:url(data:font/woff2;base64,"+data+") format('woff2')}"
fonts=font('Instrument Serif','instrument-serif-latin.woff2')+font('Instrument Serif','instrument-serif-italic-latin.woff2','italic')+font('JetBrains Mono','jetbrains-mono.woff2')
render=(root/'page.html').read_text()
assets={'DATA':root.parents[1]/'public/detail/natural-earth.json','SCORE':root.parent/'tile/score.json','SEA':root/'sea.json','NAMES':root/'names.json','RELIEF':root.parent/'relief/relief.json','JS':root/'atlas.js'}
for key,path in assets.items():render=render.replace('/*'+key+'*/',path.read_text())
lib='\n'.join((root/'vendor'/file).read_text() for file in ['d3-array.min.js','d3-geo.min.js'])
render=render.replace('/*LIB*/',lib).replace('/*FONTS*/',fonts)
out=pathlib.Path(sys.argv[1]) if len(sys.argv)>1 else root/'plate.html'
out.write_text(render)
