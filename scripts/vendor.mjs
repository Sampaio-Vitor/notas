import {copyFileSync,mkdirSync,readFileSync,writeFileSync} from 'node:fs';
mkdirSync('public/vendor',{recursive:true});
for(const [source,target] of [['framework7-bundle.min.js','framework7.js'],['framework7.min.css','framework7.css'],['LICENSE','framework7-LICENSE']])copyFileSync(`node_modules/framework7/${source}`,`public/vendor/${target}`);
// markdown-it's browser build, as a module (the app imports it). Its source map is not shipped,
// so the line that points to it goes too.
writeFileSync('public/vendor/markdown-it.js',readFileSync('node_modules/markdown-it/dist/browser/markdown-it.esm.min.mjs','utf8').replace(/\n\/\/# sourceMappingURL=.*\n?$/,'\n'));
copyFileSync('node_modules/markdown-it/LICENSE','public/vendor/markdown-it-LICENSE');
