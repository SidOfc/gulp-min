const {src, dest, symlink, watch, series, parallel, lastRun} = require('gulp');
const {Transform} = require('stream');
const glob        = require('glob');
const path        = require('path');
const fs          = require('fs-extra');
const merge       = require('merge2');
const md5         = require('md5');

const pug          = require('pug');
const babel        = require('gulp-babel');
const postcss      = require('gulp-postcss');
const autoprefixer = require('autoprefixer');
const cssnano      = require('cssnano');
const sass         = require('gulp-sass');
sass.compiler      = require('node-sass');

const connect        = require('gulp-connect');
const connectRewrite = require('connect-modrewrite');

const verbose = ['-s', '--silent', '-q', '--quiet'].every(flag => !process.argv.includes(flag));
const env     = process.env.NODE_ENV || 'development';

const rootDir  = {src: path.resolve('./src'),             dest: path.resolve('./public')};
const viewDir  = {src: path.join(rootDir.src,  'views'),  dest: rootDir.dest};
const assetDir = {src: path.join(rootDir.src,  'assets'), dest: path.join(rootDir.dest,  'assets')};
const cssDir   = {src: path.join(assetDir.src, 'css'),    dest: path.join(assetDir.dest, 'css')};
const jsDir    = {src: path.join(assetDir.src, 'js'),     dest: path.join(assetDir.dest, 'js')};
const imgDir   = {src: path.join(assetDir.src, 'img'),    dest: path.join(assetDir.dest, 'img')};

let cache        = {};
let paths        = {};
let fingerprints = {};

const isPartial = path => /^_|\/_/i.test(path);
const shouldRender = path => /\.(?:html|pug)$/i.test(path) && !isPartial(path);
const canonicalPath = path => path.replace(viewDir.src, '').replace(/(?:index)?\.(?:pug|html?)/i, '');

const buildPaths = async () => {
    paths = {root_path: '/'};

    await glob
        .sync(path.join(viewDir.src, '**/*.pug'))
        .filter(shouldRender).forEach(p => {
            const canonical = canonicalPath(p);
            const parts = canonical.slice(1).split('/').filter(x => x);

            if (parts.length > 0) paths[parts.concat('path').join('_').toLowerCase()] = canonical;
        });
};

const routes = async () => {
    await buildPaths();

    const pathEntries = Object.entries(paths);
    const longestKey  = pathEntries.reduce((longest, [n]) => n.length > longest ? n.length : longest, 0);

    return pathEntries.forEach(([helper, url]) => console.log(`${helper.padEnd(longestKey)} => ${url}`));
};

const assetPath = entry => {
    let p = entry;

    if (/\.(?:png|jpe?g|gif|svg)$/.test(entry)) p = path.join(imgDir.dest.replace(rootDir.dest, ''), entry);
    if (/\.css$/.test(entry)) p = path.join(cssDir.dest.replace(rootDir.dest, ''), entry);
    if (/\.js$/.test(entry)) p = path.join(jsDir.dest.replace(rootDir.dest, ''), entry);

    return fingerprints[p] || p;
};

const babelHelpers = ({types}) => {
    return {
        visitor: {
            CallExpression(path) {
                if (path.node.callee.name === 'asset_path') {
                    if (path.node.arguments.length === 0) {
                        throw new Error([
                            "\n[js] Function 'asset_path' expects parameter 1 to be a String path to an asset.",
                            `[js] Found in: ${this.file.opts.filename}:${path.node.loc.start.line}:${path.node.loc.start.column}\n`
                        ].join("\n"));
                    }

                    path.replaceWith(
                        types.stringLiteral(assetPath(path.node.arguments[0].value)),
                        path.node.elements
                    );
                }
            },

            Identifier(path) {
                if (paths.hasOwnProperty(path.node.name)) {
                    path.replaceWith(
                        types.stringLiteral(paths[path.node.name]),
                        path.node.elements
                    );
                }
            }
        }
    };
};

const dependencies = input => {
    const feedback = merge(input);
    const transform = new Transform({
        objectMode: true,
        transform(file, _, done) {
            const deps = cache[file.path];

            if (deps && deps.size > 0) feedback.add(src(Array.from(deps), {allowEmpty: true}));

            done(null, shouldRender(file.path) ? file : null);
        }
    });

    return feedback.pipe(transform);
};

const logger = msg => new Transform({
    objectMode: true,
    transform(file, _, done) {
        if (verbose) console.log(`${msg}: ${file.path.replace(rootDir.src, '')}`);

        done(null, file);
    }
});

const reject = pred => new Transform({
    objectMode: true,
    transform(file, _, done) {
        done(null, !pred(file) ? file : null);
    }
});

const fingerprint = (fn = p => p) => new Transform({
    objectMode: true,
    transform(file, _, done) {
        if (env === 'production') {
            const hash     = md5(file.contents.toString());
            const original = file.path;
            file.stem      = `${file.stem}-${hash}`;

            fingerprints[original.replace(rootDir.src, '')] = file.path.replace(rootDir.src, '');
        }

        done(null, file);
    }
});


const pugify = () => new Transform({
    objectMode: true,
    transform(file, _, done) {
        const compile = pug.compile(file.contents, {basedir: viewDir.src, filename: file.path});

        Object.values(cache).forEach(deps => deps.delete(file.path));
        compile.dependencies.forEach(dep => (cache[dep] = (cache[dep] || new Set()).add(file.path)));

        file.extname = '.html';
        file.contents = Buffer.from(compile({
            [env]: true,
            asset_path: assetPath,
            squeeze: str => (str || '').trim().replace(/\s+/g, ' '),
            canonical_path: canonicalPath(file.path),
            ...paths
        }));

        done(null, file);
    }
});

const serve = () => connect.server({
    root: rootDir.dest,
    port: 5000,
    livereload: true,
    middleware: () => [connectRewrite(['^.([^\\.]+)$ /$1.html [L]'])]
});

const buildHTML = () =>
    dependencies(src([
        path.join(assetDir.dest, '{css,js}/**/*.{css,js}'),
        path.join(viewDir.src, '**/*.pug')
    ], {since: lastRun(buildHTML)}))
        .pipe(pugify())
        .pipe(dest(viewDir.dest))
        .pipe(logger('compiled'))
        .pipe(connect.reload());

const buildJS = () =>
    src(path.join(jsDir.src, '**/*.js'), {since: lastRun(buildJS)})
        .pipe(reject(f => isPartial(f.path)))
        .pipe(babel({plugins: [babelHelpers]}))
        .pipe(fingerprint())
        .pipe(logger('compiled'))
        .pipe(dest(jsDir.dest));

const sassHelpers = {'asset_path($asset)': asset => sassTypes.String(assetPath(asset.getValue()))};
const buildCSS = () =>
    src(path.join(cssDir.src, '**/*.s{c,a}ss'))
        .pipe(sass({functions: sassHelpers}).on('error', sass.logError))
        .pipe(postcss([autoprefixer(), cssnano()]))
        .pipe(fingerprint())
        .pipe(logger('compiled'))
        .pipe(dest(cssDir.dest));

const watchJS = () => watch(path.join(jsDir.src, '**/*.js'), buildJS);
const watchCSS = () => watch(path.join(cssDir.src, '**/*.s{a,c}ss'), buildCSS);
const watchHTML = () => watch([
        path.join(assetDir.dest, '{css,js}/**/*.{css,js}'),
        path.join(viewDir.src, '**/*.pug')
    ], series(buildPaths, buildHTML));

const clean = () => {
    fs.removeSync(rootDir.dest);
    fs.mkdirSync(rootDir.dest);

    if (env === 'production') {
        return src(path.join(imgDir.src, '**/*.*'), {allowEmpty: true})
            .pipe(fingerprint())
            .pipe(dest(imgDir.dest))
    }

    return src(imgDir.src, {allowEmpty: true})
        .pipe(symlink(assetDir.dest));
};

const build = series(clean, buildPaths, parallel(buildJS, buildCSS), buildHTML);

exports.build = build;
exports.watch = series(build, parallel(watchJS, watchCSS, watchHTML, serve));
exports.routes = series(buildPaths, routes);
