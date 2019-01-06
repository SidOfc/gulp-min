// npm i -D chalk pug merge2 gulp gulp-babel @babel/core @babel/preset-env node-sass gulp-sass gulp-postcss
// npm i -D cssnano autoprefixer gulp-connect connect-modrewrite gulp-touch-fd fs-extra delete glob
// package.json add:
//      "babel": {
//        "presets": [
//          "@babel/preset-env"
//        ]
//      }

const chalk = require('chalk');
const pug = require('pug');
const glob = require('glob');
const path = require('path');
const fs = require('fs-extra');
const rm = require('delete');
const touch = require('gulp-touch-fd');
const merge = require('merge2');
const {src, dest, symlink, watch, series, parallel, lastRun} = require('gulp');
const util = require('util');
const {Transform} = require('stream');

const babel = require('gulp-babel');

const sass = require('gulp-sass');
sass.compiler = require('node-sass');

const postcss = require('gulp-postcss');
const autoprefixer = require('autoprefixer');
const cssnano = require('cssnano');

const connect = require('gulp-connect');
const connectRewrite = require('connect-modrewrite');

const verbose = !process.argv.includes('--silent');
const environment = (overrides = {}) =>
    overrides.production && 'production' ||
    overrides.development && 'development' ||
    overrides.sandbox && 'sandbox' ||
    process.env.NODE_ENV ||
    'development';

const cache = new Map();
const paths = new Map();
const rootDir = {src: path.resolve('./src'), dest: path.resolve('./public')}
const viewDir = {src: path.join(rootDir.src, 'views'), dest: rootDir.dest};
const assetDir = {src: path.join(rootDir.src, 'assets'), dest: path.join(rootDir.dest, 'assets')};
const cssDir = {src: path.join(assetDir.src, 'css'), dest: path.join(assetDir.dest, 'css')};
const jsDir = {src: path.join(assetDir.src, 'js'), dest: path.join(assetDir.dest, 'js')};
const imgDir = {src: path.join(assetDir.src, 'img'), dest: path.join(assetDir.dest, 'img')};

const shouldRender = path => /\.html$/.test(path) || /\.pug$/.test(path) && !/(?:^_|\/_|\/layouts).*?\.pug$|\.(?:partial|layout)\.pug$/i.test(path);
const canonicalPath = path => path.replace(viewDir.src, '').replace(/(?:index)?\.(?:pug|html?)/, '');
const map2obj = map =>
    Array.from(map.entries()).reduce((acc, [k, v]) => {
            acc[k] = v;
            return acc;
    }, {});

const logger = msg => new Transform({
    objectMode: true,
    transform(file, _, done) {
        if (verbose) console.log(`${msg}: ${file.path}`);
        done(null, file);
    }
})

const assetPath = entry => {
    if (/\.(?:png|jpe?g|gif|svg)$/.test(entry)) {
        return path.join(imgDir.dest.replace(rootDir.dest, ''), entry);
    } else if (/\.css$/.test(entry)) {
        return path.join(cssDir.dest.replace(rootDir.dest, ''), entry);
    } else if (/\.js$/.test(entry)) {
        return path.join(jsDir.dest.replace(rootDir.dest, ''), entry);
    } else return entry;
}

const routes = done => {
    const pathEntries = Object.entries(map2obj(paths));
    const longestKey  = pathEntries.reduce((longest, [n]) => n.length > longest ? n.length : longest, 0);

    pathEntries.forEach(([helper, url]) =>
        console.log(`${chalk.blue(helper.padEnd(longestKey))} ${chalk.gray('=>')} ${chalk.yellow(url)}`));

    done();
}

const pathHelpers = () => {
    paths.clear();
    return glob
        .sync(path.join(viewDir.src, '**/*.pug'))
        .reduce((helpers, p) => {
            if (shouldRender(p)) {
                const canonical = canonicalPath(p);
                const helper = canonical
                    .slice(1)
                    .split('/')
                    .concat('path')
                    .filter(x => x)
                    .join('_')
                    .toLowerCase()
                    .replace(/^path$/, 'root_path');

                paths.set(helper, canonical);
            }
        }, {});
}

const dependencies = input => {
    const feedback = merge(input);
    const transform = new Transform({
        objectMode: true,
        transform(file, _, done) {
            const deps = cache.get(file.path);

            if (deps && deps.size > 0)
                feedback.add(src(Array.from(deps), {allowEmpty: true}));

            done(null, shouldRender(file.path) ? file : null);
        }
    });

    return feedback.pipe(transform);
};

const pugify = (overrides = {}) => {
    const locals = Object.assign({[environment(overrides)]: true, ...map2obj(paths), asset_path: assetPath}, overrides);

    return new Transform({
        objectMode: true,
        transform(file, _, done) {
            const compile = pug.compile(file.contents, {basedir: viewDir.src, filename: file.path});

            cache.forEach(deps => deps.delete(file.path));
            compile.dependencies.forEach(dep => {
                const p = path.resolve(dep);

                cache.set(p, (cache.get(p) || new Set()).add(file.path));
            });

            file.contents = Buffer.from(compile(Object.assign({}, locals, {canonical_path: canonicalPath(file.path)})));
            file.extname = '.html';

            done(null, file);
        }
    });
}

const reload = () =>
    src([path.join(assetDir.dest, '{js,css}/**/*.{js,css}'), path.join(viewDir.dest, '*.html')])
        .pipe(connect.reload())

const serve = () =>
    connect.server({
        root: 'public',
        port: 5000,
        livereload: true,
        middleware: () => [connectRewrite(['^.([^\\.]+)$ /$1.html [L]'])]
    });

const buildPaths = async () => await pathHelpers();
const compileViews = () =>
    dependencies(src([
            path.join(assetDir.dest, '{css,js}/**/*.{css,js}'),
            path.join(viewDir.src, '**/*.pug')
        ], {since: lastRun(compileViews)}))
        .pipe(pugify())
        .pipe(logger('compiled'))
        .pipe(dest(viewDir.dest));

const buildHTML = series(buildPaths, compileViews);

const buildJS = () =>
    src(path.join(jsDir.src, '**/*.js'), {since: lastRun(buildJS)})
        .pipe(babel())
        .pipe(logger('compiled'))
        .pipe(dest(jsDir.dest));

const buildCSS = () =>
    src(path.join(cssDir.src, '**/*.s{c,a}ss'))
        .pipe(sass({
            functions: {
                'asset_url($asset)': asset => sassTypes.String(`url(${assetPath(asset.getValue())})`)
            }
        }).on('error', sass.logError))
        .pipe(postcss([autoprefixer(), cssnano()]))
        .pipe(logger('compiled'))
        .pipe(dest(cssDir.dest))
        .pipe(touch());

const watchPublic = () => watch([path.join(assetDir.dest, '{js,css}/**/*.{js,css}'), path.join(viewDir.dest, '*.html')], {delay: 500}, reload);
const watchJS = () => watch(path.join(jsDir.src, '**/*.js'), buildJS);
const watchCSS = () => watch(path.join(cssDir.src, '**/*.s{a,c}ss'), buildCSS);
const watchHTML = () => watch([
        path.join(assetDir.dest, '{css,js}/**/*.{css,js}'),
        path.join(viewDir.src, '**/*.pug')
    ], buildHTML);

const clean = async () => {
    await rm.promise('public');
    await util.promisify(fs.mkdir)('public');

    return src(['img'], {cwd: 'src', allowEmpty: true}).pipe(symlink('public/static', {relativeSymlinks: true}));
}

const build = series(clean, parallel(buildJS, buildCSS), buildHTML);

exports.build = build;
exports.watch = series(build, parallel(watchJS, watchCSS, watchHTML, watchPublic, serve));
exports.routes = series(build, routes);
