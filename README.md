# {{NAME}}

This generator is based on `node` and uses `gulp` together with `sass`, `babel`, `pug`, and `connect` to provide an incremental build system.
It uses `npm` scripts and `NODE_ENV` to determine the build environment.

# Setup

**This step must be skipped if the project is already set up.**

To get started, clone this repository (in `example` directory in below example) and remove the `.git` folder and `package-lock.json`
so that you can get started.

```sh
git clone https://github.com/SidOfc/gulp-min.git example
cd example
rm -rf .git package-lock.json
npm i
git init
git add .
git commit -m "Initial commit"
```

## Building

There are two modes in which this project can be generated:

- **development** &mdash; `npm run build`
- **production** &mdash; `NODE_ENV=production npm run build` (or `env NODE_ENV=production npm run build`)

Production mode enables **asset fingerprinting**.

## Watching

Watching is done by running:

```sh
npm run watch
```

#  Helpers

This generator comes with some built-in helpers such as dynamic `*_path` variables based on existing pug templates
and `asset_path` which converts asset paths.

## asset_path

This helper is available everywhere.
It resolves asset paths relative to `/assets/:type` where `:type` is either `css` for assets ending in `.css`, `js` for assets ending in `.js` and `img` for assets ending in `/\.(?:png|jpe?g|gif|svg)$/`.

When executing a build with `NODE_ENV=production`, all assets will be fingerprinted using the first 15 characters of the files' `md5`.
In this case, calling `asset_path` will output the same path but the filename will include the fingerprint.

**SASS:**

```sass
.banner
  background-image: url(asset_path(banner.svg))
```

output CSS:

```css
.banner {
    background-image: url(/assets/img/banner.svg)
}

/* NODE_ENV=production */

.banner {
    background-image: url(/assets/img/banner-b1946ac92492d23.svg)
}
```

**JS:**

_Calls to this function are replaced at transpile time which means that the output code will contain the resulting string instead of a function call to `asset_path`_.

```js
const banner_path = asset_path('banner.svg');

```

output JS:

```js
const banner_path = '/assets/img/banner.svg';

// NODE_ENV=production

const banner_path = '/assets/img/banner-b1946ac92492d23.svg';
```

**PUG:**

```pug
script(src=asset_path('application.js'))
```

output HTML:

```html
<img class="logo" src="/assets/js/application.js" />

<!-- NODE_ENV=production -->

<img class="logo" src="/assets/js/application-2ac4347e860b668.js" />
```

## [view]_path

While `asset_path` is an actual function that you can call, all other `_path` helpers are just _properties_ that get _injected_.
Paths are generated based on files present in `/src/views` directory, excluding partial paths (files or folders starting with `_`).
Since it is unlikely that you want to use view paths in SASS, there is no way to access these properties in SASS.

**JS:**

```js
const redirect_path = contact_path + "?subject=${subject}"
```

output JS:

```js
const redirect_path = '/contact' + "?subject=${subject}"
```

**PUG:**

```pug
a(href=contact_path) Contact
```

output HTML:

```html
<a href="/contact">Contact</a>
```
