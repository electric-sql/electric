# Linear.app clone with React & Tailwind CSS

A clone of [Linear app](https://linear.app/) made with React & [Tailwind CSS](http://tailwindcss.com/)


## Video Demo 
[![Linear app](http://img.youtube.com/vi/XVAek-hE5X8/0.jpg)](http://www.youtube.com/watch?v=XVAek-hE5X8)

## Setup & Run

```bash
nvm use v16.20.0
$ yarn install
$ yarn start
```

## Note
Note it isn't complete clone of Linear. Just some demo that I try to acomplish while I'm learning TailwindCss.

## License

[MIT](./LICENSE)

# --------------------------------




### add electric-sql using yalc

check out the correct branch

`checkout kevindp/fk-relations-dal-generation`

switch to the correct version of nvm (I need this one for the liner clone app code)

`nvm use v16.20.0`

install yalc and typescript

```
npm install typescript
npm install -g yalc
```

build and publish the generator with yalc

```
cd clients/typescript 
yarn build 
yalc publish --no-script
```

use yalc to add it inside this repo

`yalc add electric-sql`

and add the dependency to the package.json

```
"dependencies": {
    ...
    "electric-sql": "file:.yalc/electric-sql",
    }
```


