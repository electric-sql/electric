<a href="https://electric-sql.com">
  <picture>
    <source media="(prefers-color-scheme: dark)"
        srcset="https://raw.githubusercontent.com/electric-sql/meta/main/identity/ElectricSQL-logo-light-trans.svg"
    />
    <source media="(prefers-color-scheme: light)"
        srcset="https://raw.githubusercontent.com/electric-sql/meta/main/identity/ElectricSQL-logo-black.svg"
    />
    <img alt="ElectricSQL logo"
        src="https://raw.githubusercontent.com/electric-sql/meta/main/identity/ElectricSQL-logo-black.svg"
    />
  </picture>
</a>

# ElectricSQL - TodoMVC

This is an example TodoMVC web application using ElectricSQL in the browser with [wa-sqlite](https://github.com/rhashimoto/wa-sqlite).

## Install

Clone this repo and install all projects:

```sh
git clone https://github.com/electric-sql/electric
cd electric && pnpm install
```

Now, navigate into the todoMVC example app:
```shell
cd examples/todoMVC
```

## Generate Electric client

Let's generate an Electric client from the Prisma [schema](prisma/schema.prisma):

```sh
npx prisma generate
```

## Run

In this example, we will run the latest Electric backend locally:
```sh
cd ../../local-stack
cat .envrc
```

Make sure that `.envrc` uses the local image of Electric,
otherwise modify the `ELECTRIC_IMAGE` in `.envrc` as follows: 
```shel
export ELECTRIC_IMAGE=electric:local-build
```

Launch the local stack:
```shell
source .envrc
docker-compose up
```

Migrate the local stack such that it contains the necessary tables:
```shell
electric build
export ELECTRIC_CONSOLE_URL=http://localhost:4000
electric sync --local
```

Now, run the app:
```sh
cd ../examples/todoMVC
pnpm start
```

## More information

See the [documentation](https://electric-sql.com/docs) and [community guidelines](https://github.com/electric-sql/meta). If you need help [let us know on Discord](https://discord.gg/B7kHGwDcbj).
