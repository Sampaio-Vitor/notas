import {copyFileSync,mkdirSync} from 'node:fs';
mkdirSync('public/vendor',{recursive:true});
for(const [source,target] of [['framework7-bundle.min.js','framework7.js'],['framework7.min.css','framework7.css'],['LICENSE','framework7-LICENSE']])copyFileSync(`node_modules/framework7/${source}`,`public/vendor/${target}`);
