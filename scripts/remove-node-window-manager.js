/* eslint-disable */

import '@johnlindquist/kit';

console.log(`Removing NODE-WINDOW-MANAGER ⛳️`);

let srcFilePath = path.resolve(process.env.PWD, 'src', '*').replace(/\\/g, '/');
console.log({
  mainFilePath: srcFilePath,
});

let result = await replace({
  files: [srcFilePath],
  from: /REMOVE-NODE-WINDOW-MANAGER.*?END-REMOVE-NODE-WINDOW-MANAGER/gs,
  to: 'REMOVED BY KIT',
});

if (result.hasChanged && result.file) {
  console.log(`Updated: ${result.file} 🎉`);
}

console.log(`Kit is fun! ❤️`);
