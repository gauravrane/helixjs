var gulp = require('gulp');
var concat = require('gulp-concat');
var rename = require('gulp-rename');
var uglify = require('gulp-uglify');
var concatCallback = require('gulp-concat-callback');
var del = require('del');

var libs = [
    "libs/pako/pako_inflate.js"
];

var sourceFiles = [
    "src/Helix.js",
    "./build/tmp/*.js",
    "src/shader/glslinclude.js",

    "src/math/*.js",
    "src/core/*.js",
    "src/io/FileUtils.js",
    "src/io/URLLoader.js",
    "src/io/BulkURLLoader.js",

    // TODO: find better way for dependency management, but don't want horrible module management
    // base classes first
    "src/shader/Shader.js",
    "src/material/Material.js",
    "src/io/AssetLoader.js",
    "src/scene/Scene.js",
    "src/entity/*.js",
    "src/light/Light.js",
    "src/scene/SceneVisitor.js",

    "src/shader/*.js",
    "src/material/*.js",
    "src/scene/*.js",
    "src/mesh/*.js",
    "src/light/*.js",
    "src/mesh/primitives/*.js",
    "src/texture/*.js",
    "src/render/*.js",
    "src/effect/*.js",
    "src/animation/*.js",
    "src/io/*.js",
    "src/utils/*.js"
];

gulp.task('package', ['glsl', 'main', 'clean']);

gulp.task('default', ['glsl', 'minimize', 'clean']);

gulp.task('main', ['glsl'], function ()
{
    var sources = libs.concat(sourceFiles);
    return gulp.src(sources, {base: './'})
        .pipe(concat('helix.js'))
        .pipe(gulp.dest('./build/'));
});

gulp.task('minimize', ['main'], function ()
{
    gulp.src(['./build/helix.js'], {base: './build/'})
        .pipe(uglify())
        .pipe(rename({suffix: '.min'}))
        .pipe(gulp.dest('./build/'));
});

gulp.task('glsl', function ()
{
    return gulp.src('./src/glsl/**/*.glsl')
        .pipe(concatCallback('shaderlib.js', appendGLSL))
        .pipe(gulp.dest('./build/tmp/'));
});

gulp.task('clean', ['main', 'glsl'], function ()
{
    del('./build/tmp');
});

function appendGLSL(contents, file)
{
    contents = contents.replace(/\n/g, "\\n");
    contents = contents.replace(/\r/g, "");
    contents = contents.replace(/\'/g, "\\'");
    contents = contents.replace(/\"/g, "\\\"");
    return "HX.ShaderLibrary['" + getFileName(file) + "'] = '" + contents + "';\n";
}

function getFileName(file)
{
    var index = file.path.lastIndexOf("\\");
    index = Math.max(file.path.lastIndexOf("/"), index);
    return index < 0 ? file.path : file.path.substring(index + 1);
}