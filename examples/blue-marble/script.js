var project = new DemoProject();
var sunLight;
var earthMaterial;
var earth;
var time = 0;

var settings = {
    sunIntensity: 50.0,
    scatterIntensityBoost: 1,
    cloudColor: new HX.Color(),
    effects: []
};

// units are million km

project.onInit = function()
{
    if (HX.OPTIONS.hdr)
        initHDRSettings();
    else
        initLDRSettings();

    initCamera(this.camera);
    initScene(this.scene);

    time = 0;
};

project.onUpdate = function(dt)
{
    time += dt;
    earth.rotation.fromEuler(-23.5 * Math.PI / 180.0, time * .00001 + 1.0, 0.0);

    var v = this.camera.viewMatrix.transformVector(sunLight.direction);
    earthMaterial.setUniform("sunViewDirection", v);
};

window.onload = function ()
{
    var options = new HX.InitOptions();
    options.hdr = true;
    project.init(document.getElementById('webglContainer'), options);
};

function initHDRSettings()
{
    var bloom1 = new HX.Bloom(15, 1.0, 4);
    bloom1.thresholdLuminance = 5.0;

    var bloom2 = new HX.Bloom(100, .25, 4,.8);
    bloom2.thresholdLuminance = 5.0;

    var bloom3 = new HX.Bloom(500, .1, 8,.2);
    bloom3.thresholdLuminance = 15.0;

    // TODO: Implement pseudo lens flare

    var tonemap = new HX.FilmicToneMapEffect(true);
    tonemap.exposure = -2;

    settings.effects = [bloom1, bloom2, bloom3, tonemap];
    settings.sunIntensity = 20.0;
    settings.cloudColor = new HX.Color(0.8, 0.78, 0.75);

    settings.scatterIntensityBoost = .25;

}

function initLDRSettings()
{
    var bloom1 = new HX.Bloom(300, 1.5, 8,.75);
    bloom1.thresholdLuminance = .95;

    settings.effects = [ bloom1 ];
    settings.sunIntensity = 10.0;
    settings.cloudColor = new HX.Color(0.64, 0.624, 0.6);

    settings.scatterIntensityBoost = .25;
}

function initCamera(camera)
{
    camera.position.x = -.01;
    camera.position.y = -.0001;
    camera.position.z = -.01;
    camera.lookAt(HX.Float4.ORIGIN_POINT);
    // earth sun distance ~150

    camera.nearDistance = 0.0001;
    camera.farDistance = 1000.0;

    var controller = new FloatController();
    controller.speed = .07;
    controller.shiftMultiplier = 5.0;
    controller.yaw = Math.PI;
    camera.addComponent(controller);

    camera.addComponents(settings.effects);
}

function initSun(container)
{
    var sunPosX = 0;
    var sunPosY = 80;
    var sunPosZ = 150;

    sunLight = new HX.DirectionalLight();
    // sunlight actually has more green in its spectrum, but it's filtered out by the atmosphere
    sunLight.intensity = settings.sunIntensity;
    sunLight.color = new HX.Color(1.0, 1.0, 1.0);
    sunLight.direction = new HX.Float4(-sunPosX, -sunPosY, -sunPosZ);
    container.attach(sunLight);

    var sunSpherePrimitive = new HX.SpherePrimitive(
        {
            radius: 0.696
        }
    );
// TODO: Could replace with local light probes?
    var loader = new HX.AssetLoader(HX.HMT);
    var sunMaterial = loader.load("materials/sunMaterial.hmt");

    var sun = new HX.ModelInstance(sunSpherePrimitive, sunMaterial);
    // not heliocentric, apparently ;)
    // let's put the sun away and the earth at 0, so camera animation is easier
    sun.position.set(sunPosX, sunPosY, sunPosZ);
    container.attach(sun);
}

function initEarth(container)
{
    var earthRadius = 0.006371;
    var atmosphereScale = 1.025;
    var avgDensityHeight = .15;

    earth = new HX.GroupNode();
    var earthSpherePrimitive = new HX.SpherePrimitive(
        {
            radius: earthRadius,
            numSegmentsH: 60,
            numSegmentsW: 80
        }
    );

    var atmosphereRadius = earthRadius * atmosphereScale;
    var atmosphereTickness = atmosphereRadius - earthRadius;

    var lightDir = sunLight.worldMatrix.getColumn(2);

    var materialLoader = new HX.AssetLoader(HX.HMT);
    earthMaterial = materialLoader.load("materials/earthMaterial.hmt");
    earthMaterial.setUniform("lightDir", lightDir);
    earthMaterial.setUniform("atmosphereRadius", atmosphereRadius);
    earthMaterial.setUniform("earthRadius", earthRadius);
    earthMaterial.setUniform("rcpAtmosThickness", 1.0 / atmosphereTickness);
    earthMaterial.setUniform("rcpThicknessOverScaleDepth", 1.0 / atmosphereTickness / avgDensityHeight);
    earthMaterial.setUniform("expThicknessOverScaleDepth", Math.exp((earthRadius - atmosphereRadius) / avgDensityHeight));
    earthMaterial.lights = [ sunLight ];

    var globe = new HX.ModelInstance(earthSpherePrimitive, earthMaterial);
    earth.attach(globe);

    var atmosMaterial = materialLoader.load("materials/atmosphereMaterial.hmt");
    var atmosphere = new HX.ModelInstance(earthSpherePrimitive, atmosMaterial);

    atmosphere.scale.set(atmosphereScale, atmosphereScale, atmosphereScale);
    earth.attach(atmosphere);
    atmosMaterial.setUniform("atmosphereRadius", atmosphereRadius);
    atmosMaterial.setUniform("earthRadius", earthRadius);
    atmosMaterial.setUniform("rcpAtmosThickness", 1.0 / atmosphereTickness);
    atmosMaterial.setUniform("rcpThicknessOverScaleDepth", 1.0 / atmosphereTickness / avgDensityHeight);
    atmosMaterial.setUniform("boost", settings.sunIntensity * settings.scatterIntensityBoost);
    atmosMaterial.setUniform("lightDir", lightDir);

    earth.rotation.fromEuler(-23.5 * Math.PI / 180.0, 1.0, 0.0);

    container.attach(earth);
}

function initMoon(container)
{
    // bringing it 5x closer than it is
    var distanceToEarth = 0.384400 / 5;
    var moonRadius = 0.001737;
    var moonSpherePrimitive = new HX.SpherePrimitive(
        {
            radius: moonRadius,
            numSegmentsH: 30,
            numSegmentsW: 40
        }
    );

    var textureLoader = new HX.AssetLoader(HX.JPG);
    var colorMap = textureLoader.load("textures/moon/albedo.jpg");
    var normalMap = textureLoader.load("textures/moon/normals.png");

    var moonMaterial = new HX.BasicMaterial();
    moonMaterial.colorMap = colorMap;
    moonMaterial.normalMap = normalMap;
    moonMaterial.setRoughness(.99);
    moonMaterial.lights = [ sunLight ];

    var moon = new HX.ModelInstance(moonSpherePrimitive, moonMaterial);

    var dir = new HX.Float4(5.0,2.0,1.0);
    dir.normalize();
    dir.scale(distanceToEarth);
    moon.position.copyFrom(dir);
    moon.lookAt(HX.Float4.ORIGIN_POINT);

    container.attach(moon);
}

function initScene(scene)
{
    // rotate everything so the skybox is oriented
    var container = new HX.GroupNode();
    container.rotation.fromEuler(0, 0, .6);
    scene.attach(container);
    initSun(container);
    initEarth(container);
    initMoon(container);

    scene.detach(project.camera);
    container.attach(project.camera);

    var envMapLoader = new HX.AssetLoader(HX.JPG_EQUIRECTANGULAR);
    var skyboxTexture = envMapLoader.load("textures/skybox/milkyway.jpg");
    scene.skybox = new HX.Skybox(skyboxTexture);
}