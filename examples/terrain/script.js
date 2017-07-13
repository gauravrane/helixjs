/**
 * @author derschmale <http://www.derschmale.com>
 */

var project = new DemoProject();
var terrainMaterial;
var waterMaterial;
var time = 0;

// 1 = 10m
var worldSize = 5000;
var waterLevel = -15;
var fog;

project.onInit = function()
{
    initCamera(this.camera);
    initScene(this.scene);

    /*var ssao = new HX.HBAO();
    ssao.radius = 50.0;
    ssao.strength = 3.14;
    ssao.fallOffDistance = 100.0;
    ssao.bias = 0.1;
    this.renderer.ambientOcclusion = ssao;*/

    time = 0;
};

project.onUpdate = function(dt)
{
    time += dt;
    waterMaterial.setUniform("normalOffset1", [ -time * 0.0004, -time * 0.0005 ]);
    waterMaterial.setUniform("normalOffset2", [ time * 0.0001, time * 0.0002 ]);
};

window.onload = function ()
{
    var options = new HX.InitOptions();
    options.numShadowCascades = 3;
    options.hdr = true;
    options.defaultLightingModel = HX.LightingModel.GGX;
    options.directionalShadowFilter = new HX.VarianceDirectionalShadowFilter();
    options.directionalShadowFilter.blurRadius = 1;
    project.init(document.getElementById('webglContainer'), options);
};

function initCamera(camera)
{
    camera.position.x = (1680 / 2048 - .5) * worldSize;
    camera.position.y = waterLevel + .18;
    camera.position.z = -(1814 / 2048 - .5) * worldSize;

    camera.nearDistance = 0.1;
    camera.farDistance = 2000.0;

    var controller = new HX.FloatController();
    controller.speed = 1.7;
    controller.shiftMultiplier = 100.0;
    controller.yaw = Math.PI;
    camera.addComponent(controller);

    fog = new HX.Fog(0.00025, new HX.Color(0x3977ff), 0.0005);
    camera.addComponent(fog);

    var tonemap = new HX.FilmicToneMapping();
    tonemap.exposure = 0.0;
    camera.addComponent(tonemap);
}

function initScene(scene)
{
    var sun = new HX.DirectionalLight();
    sun.direction = new HX.Float4(-0.3, -.3, 1.0, 0.0);
    // sun.depthBias = 10.0;
    sun.intensity = 3;
    sun.castShadows = true;
    // sun.shadowMapSize = 1024;
    // sun.setCascadeRatios(.01,.07,.15, .3);
    scene.attach(sun);

    // TODO: Add procedural skybox

    var cubeLoader = new HX.AssetLoader(HX.HCM);
    var skyboxSpecularTexture = cubeLoader.load("textures/skybox/skybox_specular.hcm");
    var skyboxIrradianceTexture = cubeLoader.load("textures/skybox/skybox_irradiance.hcm");
    var skybox = new HX.Skybox(skyboxSpecularTexture);
    scene.skybox = skybox;

    var lightProbe = new HX.LightProbe(skyboxIrradianceTexture, skyboxSpecularTexture);
    scene.attach(lightProbe);

    var heightMapLoader = new HX.AssetLoader(HX.JPG_HEIGHTMAP);
    var heightMap = heightMapLoader.load("textures/heightMap.png");
    var textureLoader = new HX.AssetLoader(HX.JPG);
    var terrainMap = textureLoader.load("textures/terrainMap.jpg");

    // in our material
    // red = beach
    // green = rock
    // blue = snow
    // otherwise, fall back to grass
    var materialLoader = new HX.AssetLoader(HX.HMT);
    terrainMaterial = materialLoader.load("material/terrainMaterial.hmt");
    terrainMaterial.setTexture("heightMap", heightMap);
    terrainMaterial.setTexture("terrainMap", terrainMap);
    terrainMaterial.setUniform("heightMapSize", 2048);
    terrainMaterial.setUniform("worldSize", worldSize);
    // terrainMaterial.ssao = true;

    waterMaterial = materialLoader.load("material/waterMaterial.hmt");

    var terrain = new HX.Terrain(4000, -100, 200, 5, terrainMaterial, 64);

    var water = new HX.Terrain(4000, 0, 1, 3, waterMaterial, 16);
    water.position.y = waterLevel;

    scene.attach(terrain);
    scene.attach(water);
}