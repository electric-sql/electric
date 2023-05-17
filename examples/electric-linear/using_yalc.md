### Using yalc

At the moment in this example the dependencies on Electric's own js packages 
`prisma-generator-electric` and `electric-sql` are being managed using yalc 
[https://github.com/wclr/yalc](https://github.com/wclr/yalc), this a tool that helps 
manage dependencies on local development modules.

switch to the correct version of node (I need this one for the liner clone app code)

`nvm use v16.20.0`

install yalc globally

```
npm install -g yalc
```

Build and publish `prisma-generator-electric` with yalc

```
cd generator 
yarn build 
chmod +x ./dist/bin.js
yalc publish --no-script
cd ..
```

Build and publish `electric-sql` with yalc

```
cd clients/typescript 
yarn build 
yalc publish --no-script
```

use yalc these modules where you need them

`yalc add prisma-generator-electric`

`yalc add electric-sql`