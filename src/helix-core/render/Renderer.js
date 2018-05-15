import {Color} from "../core/Color";
import {RenderCollector} from "./RenderCollector";
import {ApplyGammaShader, CopyChannelsShader} from "./UtilShaders";
import {Texture2D} from "../texture/Texture2D";
import {MaterialPass} from "../material/MaterialPass";
import {RectMesh} from "../mesh/RectMesh";
import {TextureFormat, TextureFilter, TextureWrapMode, META, capabilities} from "../Helix";
import {FrameBuffer} from "../texture/FrameBuffer";
import {GL} from "../core/GL";
import {RenderUtils} from "./RenderUtils";
import {WriteOnlyDepthBuffer} from "../texture/WriteOnlyDepthBuffer";
import {DirectionalLight} from "../light/DirectionalLight";
import {PointLight} from "../light/PointLight";
import {LightProbe} from "../light/LightProbe";
import {RenderPath} from "./RenderPath";
import {SpotLight} from "../light/SpotLight";
import {ShadowAtlas} from "./ShadowAtlas";
import {CascadeShadowMapRenderer} from "./CascadeShadowMapRenderer";
import {OmniShadowMapRenderer} from "./OmniShadowMapRenderer";
import {SpotShadowMapRenderer} from "./SpotShadowMapRenderer";
import {BasicMaterial} from "../material/BasicMaterial";
import {LightingModel} from "./LightingModel";
import {Float4} from "../math/Float4";
import {Matrix4x4} from "../math/Matrix4x4";
import {MathX} from "../math/MathX";
import {TextureCube} from "../texture/TextureCube";
import {UniformBuffer} from "../core/UniformBuffer";

/**
 * @classdesc
 * Renderer performs the actual rendering of a {@linkcode Scene} as viewed by a {@linkcode Camera} to the screen.
 *
 * @constructor
 *
 * @author derschmale <http://www.derschmale.com>
 */
function Renderer()
{
    this._width = 0;
    this._height = 0;

    this._depthPrepass = false;
    this._gammaApplied = false;

    this._copyTextureShader = new CopyChannelsShader("xyzw", true);
    this._applyGamma = new ApplyGammaShader();

    this._camera = null;
    this._scene = null;
    this._depthBuffer = this._createDepthBuffer();
    this._hdrBack = new Renderer.HDRBuffers(this._depthBuffer);
    this._hdrFront = new Renderer.HDRBuffers(this._depthBuffer);
    this._renderCollector = new RenderCollector();
    this._normalDepthBuffer = new Texture2D();
    this._normalDepthBuffer.filter = TextureFilter.BILINEAR_NOMIP;
    this._normalDepthBuffer.wrapMode = TextureWrapMode.CLAMP;
    this._normalDepthFBO = new FrameBuffer(this._normalDepthBuffer, this._depthBuffer);

    this._backgroundColor = Color.BLACK.clone();
    //this._previousViewProjection = new Matrix4x4();
    this._debugMode = Renderer.DebugMode.NONE;
    this._ssaoTexture = null;

    this._cascadeShadowRenderer = new CascadeShadowMapRenderer();
    this._omniShadowRenderer = new OmniShadowMapRenderer();
    this._spotShadowRenderer = new SpotShadowMapRenderer();
    this._shadowAtlas = new ShadowAtlas(!!META.OPTIONS.shadowFilter.blurShader);
    this._shadowAtlas.resize(2048, 2048);

    if (capabilities.WEBGL_2) {
		var size = 16 + META.OPTIONS.maxDirLights * 320 + META.OPTIONS.maxLightProbes * 16 + META.OPTIONS.maxPointSpotLights * 224;
		this._diffuseProbeArray = [];
		this._specularProbeArray = [];
		this._lightingUniformBuffer = new UniformBuffer(size);

		this._lightingData = new ArrayBuffer(size);
		this._lightingDataView = new DataView(this._lightingData);

		var i = 0;
		for (var i = 0; i < size; ++i)
		    this._lightingDataView.setInt8(i, 0);


		// if we want to test the layout of the uniform buffer as defined in the shader:
		var material = new BasicMaterial({ lightingModel: LightingModel.GGX });
		var pass = material.getPass(MaterialPass.BASE_PASS);
		this._lightingUniformBuffer = pass.createUniformBufferFromShader("hx_lights");
		console.log(this._lightingUniformBuffer);
    }
}

/**
 * A collection of debug render modes to inspect some steps in the render pipeline.
 * @enum
 */
Renderer.DebugMode = {
    NONE: 0,
    SSAO: 1,
    NORMAL_DEPTH: 2,
    SHADOW_MAP: 3
};

/**
 * @ignore
 */
Renderer.HDRBuffers = function(depthBuffer)
{
    this.texture = new Texture2D();
    this.texture.filter = TextureFilter.BILINEAR_NOMIP;
    this.texture.wrapMode = TextureWrapMode.CLAMP;
    this.fbo = new FrameBuffer(this.texture);
    this.fboDepth = new FrameBuffer(this.texture, depthBuffer);
};

Renderer.HDRBuffers.prototype =
{
    resize: function(width, height)
    {
        this.texture.initEmpty(width, height, TextureFormat.RGBA, capabilities.HDR_FORMAT);
        this.fbo.init();
        this.fboDepth.init();
    }
};

Renderer.prototype =
{
    /**
     * One of {Renderer.DebugMode}
     */
    get debugMode()
    {
        return this._debugMode;
    },

    set debugMode(value)
    {
        this._debugMode = value;
    },

    /**
     * The size of the shadow atlas texture.
     */
    get shadowMapSize()
    {
        return this._shadowAtlas.width;
    },

    set shadowMapSize(value)
    {
        this._shadowAtlas.resize(value, value);
    },

    /**
     * Defines whether or not a depth pre-pass needs to be performed when rendering. This may improve rendering by
     * spending less time calculating lighting on invisible fragments.
     */
    get depthPrepass()
    {
        return this._depthPrepass;
    },

    set depthPrepass(value)
    {
        this._depthPrepass = value;
    },

    /**
     * The background {@linkcode Color}.
     */
    get backgroundColor()
    {
        return this._backgroundColor;
    },

    set backgroundColor(value)
    {
        if (value instanceof Color)
            this._backgroundColor.copyFrom(value);
        else
            this._backgroundColor.set(value);
    },

    /**
     * The Camera currently being used for rendering.
     */
    get camera()
    {
        return this._camera;
    },

    /**
     * Renders the scene through a camera.
     * It's not recommended changing render targets if they have different sizes (so splitscreen should be fine). Otherwise, use different renderer instances.
     * @param camera The {@linkcode Camera} from which to view the scene.
     * @param scene The {@linkcode Scene} to render.
     * @param dt The milliseconds passed since last frame.
     * @param [renderTarget] An optional {@linkcode FrameBuffer} object to render to.
     */
    render: function (camera, scene, dt, renderTarget)
    {
        this._gammaApplied = false;
        this._camera = camera;
        this._scene = scene;

        this._updateSize(renderTarget);

        camera._setRenderTargetResolution(this._width, this._height);
        this._renderCollector.collect(camera, scene);

        this._ambientColor = this._renderCollector._ambientColor;

        this._renderShadowCasters();

        GL.setDepthMask(true);
        GL.setColorMask(true);

        this._renderNormalDepth();
        this._renderAO();

        GL.setRenderTarget(this._hdrFront.fboDepth);
        GL.setClearColor(this._backgroundColor);
        GL.clear();

        this._renderDepthPrepass();

        if (capabilities.WEBGL_2)
            this._renderClustered();
        else {
            this._renderForwardOpaque();
            this._renderForwardTransparent();
        }

        this._swapHDRFrontAndBack();
        this._renderEffects(dt);

        GL.setColorMask(true);

        this._renderToScreen(renderTarget);

        GL.setBlendState();
        GL.setDepthMask(true);

        // for the future, if we ever need back-projection
        //this._previousViewProjection.copyFrom(this._camera.viewProjectionMatrix);
    },

    /**
     * @ignore
     * @private
     */
    _renderDepthPrepass: function ()
    {
        if (!this._depthPrepass) return;

        GL.lockColorMask(false);
        RenderUtils.renderPass(this, MaterialPass.NORMAL_DEPTH_PASS, this._renderCollector.getOpaqueRenderList(RenderPath.FORWARD_FIXED));
        RenderUtils.renderPass(this, MaterialPass.NORMAL_DEPTH_PASS, this._renderCollector.getOpaqueRenderList(RenderPath.FORWARD_DYNAMIC));
        GL.unlockColorMask(true);
    },

    _renderClustered: function()
    {
        var lights = this._renderCollector.getLights();
        var numLights = lights.length;
        var data = this._lightingDataView;
        var camera = this._camera;
        var maxDirLights = META.OPTIONS.maxDirLights;
        var maxProbes = META.OPTIONS.maxLightProbes;
        var maxPoints = META.OPTIONS.maxPointSpotLights;
        var dirLightOffset = 16;
        var dirLightStride = 320;
        var probeStride = 16;
        var probeOffset = maxDirLights * dirLightStride + dirLightOffset;
        var pointOffset = maxProbes * probeStride + probeOffset;
        var pointStride = 224;
        var numDirLights = 0;
        var numPointLights = 0;
        var numProbes = 0;

        for (var i = 0; i < maxProbes; ++i) {
            this._diffuseProbeArray[i] = TextureCube.DEFAULT;
            this._specularProbeArray[i] = TextureCube.DEFAULT;
        }

        for (var i = 0; i < numLights; ++i) {
            var light = lights[i];

            if (light instanceof DirectionalLight && numDirLights < maxDirLights) {
                this.writeDirectionalLight(light, camera, data, dirLightOffset);

                dirLightOffset += dirLightStride;
                ++numDirLights;
            }
            else if (light instanceof LightProbe && numProbes < maxProbes) {
                this.writeLightProbe(light, data, probeOffset);

                if (light.diffuseTexture)
                    this._diffuseProbeArray[numProbes] = light.diffuseTexture;

                if (light.specularTexture)
                    this._specularProbeArray[numProbes] = light.specularTexture;

                probeOffset += probeStride;
                ++numProbes;
            }
            else if (light instanceof PointLight && numPointLights < maxPoints) {
                this.writePointSpotLight(light, camera, data, pointOffset, false);

                pointOffset += pointStride;
                ++numPointLights;
            }
            else if (light instanceof SpotLight && numPointLights < maxPoints) {
                this.writePointSpotLight(light, camera, data, pointOffset, true);

                pointOffset += pointStride;
                ++numPointLights;
            }
        }

        data.setInt32(0, numDirLights, true);
        data.setInt32(4, numProbes, true);
        data.setInt32(8, numPointLights, true);

        this._lightingUniformBuffer.uploadData(this._lightingDataView);

        RenderUtils.renderPass(this, MaterialPass.BASE_PASS, this._renderCollector.getOpaqueRenderList(RenderPath.FORWARD_FIXED));
        RenderUtils.renderPass(this, MaterialPass.BASE_PASS, this._renderCollector.getOpaqueRenderList(RenderPath.FORWARD_DYNAMIC));
        RenderUtils.renderPass(this, MaterialPass.BASE_PASS, this._renderCollector.getTransparentRenderList(RenderPath.FORWARD_FIXED));
        RenderUtils.renderPass(this, MaterialPass.BASE_PASS, this._renderCollector.getTransparentRenderList(RenderPath.FORWARD_DYNAMIC));
    },

    /**
     * @ignore
     * @private
     */
    writePointSpotLight: function(light, camera, target, offset, isSpot)
    {
        var pos = new Float4();
        var matrix = new Matrix4x4();
        return function(light, camera, target, offset, isSpot)
        {
            var o;
            var col = light._scaledIrradiance;
            target.setFloat32(offset, col.r, true);
            target.setFloat32(offset + 4, col.g, true);
            target.setFloat32(offset + 8, col.b, true);

            target.setFloat32(offset + 12, light.radius, true);

            light.worldMatrix.getColumn(3, pos);
            camera.viewMatrix.transformPoint(pos, pos);
            target.setFloat32(offset + 16, pos.x, true);
            target.setFloat32(offset + 20, pos.y, true);
            target.setFloat32(offset + 24, pos.z, true);

            target.setFloat32(offset + 28, 1.0 / light.radius, true);

            light.worldMatrix.getColumn(1, pos);
            camera.viewMatrix.transformVector(pos, pos);
            target.setFloat32(offset + 32, pos.x, true);
            target.setFloat32(offset + 36, pos.y, true);
            target.setFloat32(offset + 40, pos.z, true);

            if (isSpot) {
                target.setUint32(offset + 112, 1, true);
                target.setFloat32(offset + 120, light._cosOuter, true);
                target.setFloat32(offset + 124, 1.0 / Math.max((light._cosInner - light._cosOuter), .00001), true);
            }
            else {
                target.setUint32(offset + 112, 0, true);
            }

            target.setUint32(offset + 116, light.castShadows? 1 : 0, true);

            if (light.castShadows) {
                target.setFloat32(offset + 44, light.depthBias, true);

                var m;

                if (isSpot) {
                    matrix.multiply(light._shadowMatrix, camera.worldMatrix);
                    m = matrix._m;

                    var tile = light._shadowTile;
                    target.setFloat32(offset + 128, tile.x, true);
                    target.setFloat32(offset + 132, tile.y, true);
                    target.setFloat32(offset + 136, tile.z, true);
                    target.setFloat32(offset + 140, tile.w, true);
                }
                else {
                    m = camera.worldMatrix._m;

                    o = offset + 128;
                    for (var face = 0; face < 6; ++face) {
                        var tile = light._shadowTiles[face];
                        target.setFloat32(o, tile.x, true);
                        target.setFloat32(o + 4, tile.y, true);
                        target.setFloat32(o + 8, tile.z, true);
                        target.setFloat32(o + 12, tile.w, true);
                        o += 16;
                    }
                }

                o = offset + 48;

                for (var l = 0; l < 16; ++l) {
                    target.setFloat32(o, m[l], true);
                    o += 4;
                }

            }
        }
    }(),

    /**
     * @ignore
     * @private
     */
    writeLightProbe: function(light, target, offset)
    {
        target.setUint32(offset, light.diffuseTexture? 1: 0, true);

        var specularTex = light.specularTexture;
        if (specularTex) {
            target.setUint32(offset + 4, 1, true);
            var numMips = Math.floor(MathX.log2(specularTex.size));
            target.setFloat32(offset + 8, numMips, true);
        }
        else {
            target.setUint32(offset + 4, 0, true);
        }
    },

    /**
     * @ignore
     * @private
     */
    writeDirectionalLight: function(light, camera, target, offset)
    {
        var dir = new Float4();
        var matrix = new Matrix4x4();
        return function(light, camera, target, offset)
        {
            var col = light._scaledIrradiance;
            target.setFloat32(offset, col.r, true);
            target.setFloat32(offset + 4, col.g, true);
            target.setFloat32(offset + 8, col.b, true);

            camera.viewMatrix.transformVector(light.direction, dir);
            target.setFloat32(offset + 16, dir.x, true);
            target.setFloat32(offset + 20, dir.y, true);
            target.setFloat32(offset + 24, dir.z, true);

            target.setUint32(offset + 28, light.castShadows? 1 : 0, true);

            if (light.castShadows) {
                var numCascades = META.OPTIONS.numShadowCascades;
                var splits = light._cascadeSplitDistances;

                var m = matrix._m;
                var o = offset + 32;

                for (var j = 0; j < numCascades; ++j) {
                    matrix.multiply(light.getShadowMatrix(j), camera.worldMatrix);

                    for (var l = 0; l < 16; ++l) {
                        target.setFloat32(o, m[l], true);
                        o += 4;
                    }
                }

                target.setFloat32(offset + 288, splits[0], true);
                target.setFloat32(offset + 292, splits[1], true);
                target.setFloat32(offset + 296, splits[2], true);
                target.setFloat32(offset + 300, splits[3], true);
                target.setFloat32(offset + 304, light.depthBias, true);
                target.setFloat32(offset + 308, splits[numCascades - 1], true);
            }
        }
    }(),

    /**
     * @ignore
     * @private
     */
    _renderForwardOpaque: function()
    {
        RenderUtils.renderPass(this, MaterialPass.BASE_PASS, this._renderCollector.getOpaqueRenderList(RenderPath.FORWARD_FIXED));

        var list = this._renderCollector.getOpaqueRenderList(RenderPath.FORWARD_DYNAMIC);
        if (list.length === 0) return;

        this._renderOpaqueDynamicMultipass(list);
    },

    _renderOpaqueDynamicMultipass: function(list)
    {
        RenderUtils.renderPass(this, MaterialPass.BASE_PASS, list);

        var lights = this._renderCollector.getLights();
        var numLights = lights.length;

        for (var i = 0; i < numLights; ++i) {
            var light = lights[i];

            // I don't like type checking, but lighting support is such a core thing...
            // maybe we can work in a more plug-in like light system
            if (light instanceof LightProbe) {
                RenderUtils.renderPass(this, MaterialPass.LIGHT_PROBE_PASS, list, light);
            }
            else if (light instanceof DirectionalLight) {
                // PASS IN LIGHT AS DATA, so the material can update it
                RenderUtils.renderPass(this, MaterialPass.DIR_LIGHT_PASS, list, light);
            }
            else if (light instanceof PointLight) {
                // cannot just use renderPass, need to do intersection tests
                this._renderLightPassIfIntersects(light, MaterialPass.POINT_LIGHT_PASS, list);
            }
            else if (light instanceof SpotLight) {
                this._renderLightPassIfIntersects(light, MaterialPass.SPOT_LIGHT_PASS, list);
            }
        }
    },

    _renderForwardTransparent: function()
    {
        var lights = this._renderCollector.getLights();
        var numLights = lights.length;

        var list = this._renderCollector.getTransparentRenderList();

        // transparents need to be rendered one-by-one, not light by light
        var numItems = list.length;
        for (var r = 0; r < numItems; ++r) {

            var renderItem = list[r];

            this._renderSingleItemSingleLight(MaterialPass.BASE_PASS, renderItem);

            var material = renderItem.material;

            // these won't have the correct pass
            if (material._renderPath !== RenderPath.FORWARD_DYNAMIC) continue;

            for (var i = 0; i < numLights; ++i) {
                var light = lights[i];

                // I don't like type checking, but lighting support is such a core thing...
                // maybe we can work in a more plug-in like light system
                if (light instanceof LightProbe) {
                    this._renderSingleItemSingleLight(MaterialPass.LIGHT_PROBE_PASS, renderItem, light);
                }
                else if (light instanceof DirectionalLight) {
                    // if non-global, do intersection tests
                    var passType = light.castShadows? MaterialPass.DIR_LIGHT_SHADOW_PASS : MaterialPass.DIR_LIGHT_PASS;
                    this._renderSingleItemSingleLight(passType, renderItem, light);
                }
                else if (light instanceof PointLight) {
                    // cannot just use renderPass, need to do intersection tests
                    this._renderLightPassIfIntersects(light, MaterialPass.POINT_LIGHT_PASS, list);
                }
                else if (light instanceof SpotLight) {
                    // cannot just use renderPass, need to do intersection tests
                    this._renderLightPassIfIntersects(light, MaterialPass.SPOT_LIGHT_PASS, list);
                }
            }
        }

        GL.setBlendState();
    },

    /**
     * @ignore
     * @private
     */
    _renderLightPassIfIntersects: function(light, passType, renderList)
    {
        var lightBound = light.worldBounds;
        var len = renderList.length;
        for (var r = 0; r < len; ++r) {
            var renderItem = renderList[r];
            var material = renderItem.material;
            var pass = material.getPass(passType);
            if (!pass) continue;

            if (lightBound.intersectsBound(renderItem.worldBounds))
                this._renderSingleItemSingleLight(passType, renderItem, light);
        }
    },

    _renderSingleItemSingleLight: function(passType, renderItem, light)
    {
        var pass = renderItem.material.getPass(passType);
        if (!pass) return;
        var meshInstance = renderItem.meshInstance;
        pass.updatePassRenderState(renderItem.camera, this, light);
        pass.updateInstanceRenderState(renderItem.camera, renderItem, light);
        meshInstance.updateRenderState(passType);
        var mesh = meshInstance._mesh;
        GL.drawElements(pass._elementType, mesh._numIndices, 0, mesh._indexType);
    },

    /**
     * @ignore
     * @private
     */
    _renderNormalDepth: function()
    {
        var rc = this._renderCollector;
        var dynamic = rc.getOpaqueRenderList(RenderPath.FORWARD_DYNAMIC);
        var fixed = rc.getOpaqueRenderList(RenderPath.FORWARD_FIXED);

        if (rc.needsNormalDepth) {
            GL.setRenderTarget(this._normalDepthFBO);
            GL.setClearColor(Color.BLUE);
            GL.clear();
            RenderUtils.renderPass(this, MaterialPass.NORMAL_DEPTH_PASS, dynamic);
            RenderUtils.renderPass(this, MaterialPass.NORMAL_DEPTH_PASS, fixed);
        }
    },

    /**
     * @ignore
     * @private
     */
    _renderAO: function()
    {
        var ssao = META.OPTIONS.ambientOcclusion;
        if (ssao) {
            this._ssaoTexture = ssao.getAOTexture();
            ssao.render(this, 0);
        }
    },

    /**
     * @ignore
     * @private
     */
    _renderShadowCasters: function()
    {
        this._shadowAtlas.initRects(this._renderCollector.shadowPlaneBuckets, this._renderCollector.numShadowPlanes);

        var casters = this._renderCollector.getShadowCasters();
        var len = casters.length;

        GL.setRenderTarget(this._shadowAtlas.fbo);
        GL.setClearColor(Color.WHITE);
        GL.clear();

        for (var i = 0; i < len; ++i) {
            var light = casters[i];

            // TODO: Reintroduce light types, use lookup

            if (light instanceof DirectionalLight) {
                this._cascadeShadowRenderer.render(light, this._shadowAtlas, this._camera, this._scene);
            }
            else if (light instanceof PointLight) {
                this._omniShadowRenderer.render(light, this._shadowAtlas, this._camera, this._scene);
            }
            else if (light instanceof SpotLight) {
                this._spotShadowRenderer.render(light, this._shadowAtlas, this._camera, this._scene);
            }
        }

        this._shadowAtlas.blur();
    },

    /**
     * @ignore
     * @private
     */
    _renderEffect: function (effect, dt)
    {
        this._gammaApplied = this._gammaApplied || effect._outputsGamma;
        effect.render(this, dt);
    },

    /**
     * @ignore
     * @private
     */
    _renderToScreen: function (renderTarget)
    {
        GL.setRenderTarget(renderTarget);
        GL.clear();

        if (this._debugMode) {
            var tex;
            switch (this._debugMode) {
                case Renderer.DebugMode.NORMAL_DEPTH:
                    tex = this._normalDepthBuffer;
                    break;
                case Renderer.DebugMode.SHADOW_MAP:
                    tex = this._shadowAtlas.texture;
                    break;
                case Renderer.DebugMode.SSAO:
                    tex = this._ssaoTexture;
                    break;
                default:
                    // nothing
            }
            this._copyTextureShader.execute(RectMesh.DEFAULT, tex);
            return;
        }

        if (this._gammaApplied)
            this._copyTextureShader.execute(RectMesh.DEFAULT, this._hdrBack.texture);
        else
            this._applyGamma.execute(RectMesh.DEFAULT, this._hdrBack.texture);
    },

    /**
     * @ignore
     * @private
     */
    _renderEffects: function (dt)
    {
        var effects = this._renderCollector.getEffects();
        if (!effects) return;

        var len = effects.length;

        for (var i = 0; i < len; ++i) {
            var effect = effects[i];
            if (effect.isSupported()) {
                this._renderEffect(effect, dt);
                this._swapHDRFrontAndBack();
            }
        }
    },

    /**
     * @ignore
     * @private
     */
    _updateSize: function (renderTarget)
    {
        var width, height;
        if (renderTarget) {
            width = renderTarget.width;
            height = renderTarget.height;
        }
        else {
            width = META.TARGET_CANVAS.width;
            height = META.TARGET_CANVAS.height;
        }

        if (this._width !== width || this._height !== height) {
            this._width = width;
            this._height = height;
            this._depthBuffer.init(this._width, this._height, true);
            this._hdrBack.resize(this._width, this._height);
            this._hdrFront.resize(this._width, this._height);
            this._normalDepthBuffer.initEmpty(width, height);
            this._normalDepthFBO.init();
        }
    },

    /**
     * @ignore
     */
    _swapHDRFrontAndBack: function()
    {
        var tmp = this._hdrBack;
        this._hdrBack = this._hdrFront;
        this._hdrFront = tmp;
    },

    /**
     * @ignore
     * @private
     */
    _createDepthBuffer: function()
    {
        /*if (HX.EXT_DEPTH_TEXTURE) {
            this._depthBuffer = new HX.Texture2D();
            this._depthBuffer.filter = HX.TextureFilter.BILINEAR_NOMIP;
            this._depthBuffer.wrapMode = HX.TextureWrapMode.CLAMP;
        }
        else {*/
            return new WriteOnlyDepthBuffer();
    }
};

export { Renderer };