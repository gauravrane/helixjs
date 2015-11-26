/**
 * The debug render mode to inspect properties in the GBuffer, the lighting accumulation buffer, AO, etc.
 */
HX.DebugRenderMode = {
    DEBUG_NONE: 0,
    DEBUG_COLOR: 1,
    DEBUG_NORMALS: 2,
    DEBUG_METALLICNESS: 3,
    DEBUG_SPECULAR_NORMAL_REFLECTION: 4,
    DEBUG_ROUGHNESS: 5,
    DEBUG_DEPTH: 6,
    DEBUG_LIGHT_ACCUM: 7,
    DEBUG_AO: 8,
    DEBUG_SSR: 9
};


/**
 * Renderer is the main renderer for drawing a Scene to the screen.
 *
 * GBUFFER LAYOUT:
 * 0: COLOR: (color.XYZ, transparency (only when using transparencyMode))
 * 1: NORMALS: (normals.XYZ, unused, or normals.xy, depth.zw if depth texture not supported)
 * 2: REFLECTION: (roughness, normalSpecularReflection, metallicness, unused)
 * 3: LINEAR DEPTH: (not explicitly written to by user), 0 - 1 linear depth encoded as RGBA
 *
 * @constructor
 */
HX.Renderer = function ()
{
    this._width = 0;
    this._height = 0;

    this._copyTexture = new HX.CopyChannelsShader();
    this._copyTextureToScreen = new HX.CopyChannelsShader("xyzw", true);
    this._copyXChannel = new HX.CopyChannelsShader("x");
    this._copyYChannel = new HX.CopyChannelsShader("y");
    this._copyZChannel = new HX.CopyChannelsShader("z");
    this._copyWChannel = new HX.CopyChannelsShader("w");
    this._debugDepth = new HX.DebugDepthShader();
    this._debugNormals = new HX.DebugNormalsShader();
    this._applyAlphaTransparency = new HX.CopyWithSeparateAlpha();
    this._applyGamma = new HX.ApplyGammaShader();
    this._gammaApplied = false;
    this._linearizeDepthShader = new HX.LinearizeDepthShader();

    this._renderCollector = new HX.RenderCollector();
    this._gbufferFBO = null;
    this._linearDepthFBO = null;
    this._depthBuffer = null;
    this._aoEffect = null;
    this._aoTexture = null;
    this._ssrEffect = null;

    this._createGBuffer();

    this._hdrBack = new HX.Renderer.HDRBuffers(this._depthBuffer);
    this._hdrFront = new HX.Renderer.HDRBuffers(this._depthBuffer);

    this._debugMode = HX.DebugRenderMode.DEBUG_NONE;
    this._camera = null;
};

HX.Renderer.HDRBuffers = function(depthBuffer)
{
    this.texture = new HX.Texture2D();
    this.texture.setFilter(HX.TextureFilter.BILINEAR_NOMIP);
    this.texture.setWrapMode(HX.TextureWrapMode.CLAMP);
    this.fbo = new HX.FrameBuffer(this.texture);
    this.fboDepth = new HX.FrameBuffer(this.texture, depthBuffer);
};

HX.Renderer.HDRBuffers.prototype =
{
    dispose: function()
    {
        this.texture.dispose();
        this.fbo.dispose();
        this.fboDepth.dispose();
    },

    resize: function(width, height)
    {
        this.texture.initEmpty(width, height, HX.GL.RGBA, HX.HDR_FORMAT);
        this.fbo.init();
        this.fboDepth.init();
    }
};

HX.Renderer.prototype =
{
    get debugMode()
    {
        return this._debugMode;
    },

    set debugMode(value)
    {
        this._debugMode = value;
    },

    get ambientOcclusion()
    {
        return this._aoEffect;
    },

    set ambientOcclusion(value)
    {
        this._aoEffect = value;
        this._aoTexture = this._aoEffect ? this._aoEffect.getAOTexture() : null;
    },

    get localReflections()
    {
        return this._ssrEffect;
    },

    set localReflections(value)
    {
        this._ssrEffect = value;
        this._ssrTexture = this._ssrEffect? this._ssrEffect.getSSRTexture() : null;
    },

    resize: function (width, height)
    {
        if (this._width != width || this._height != height) {
            this._updateGBuffer(width, height);
            this._hdrBack.resize(width, height);
            this._hdrFront.resize(width, height);
        }

        this._width = width;
        this._height = height;
    },

    render: function (camera, scene, dt)
    {
        var stackSize = HX._renderTargetStack.length;
        this._gammaApplied = false;
        this._camera = camera;
        this._scene = scene;

        HX.GL.enable(HX.GL.DEPTH_TEST);
        HX.GL.enable(HX.GL.CULL_FACE);
        HX.GL.cullFace(HX.GL.BACK);
        HX.GL.depthFunc(HX.GL.LESS);

        camera._setRenderTargetResolution(this._width, this._height);
        this._renderCollector.collect(camera, scene);

        this._renderShadowCasters();

        HX.pushRenderTarget(this._hdrFront.fboDepth);
        {
            this._renderOpaques();

            this._renderPostPass(HX.MaterialPass.POST_LIGHT_PASS);
            this._renderPostPass(HX.MaterialPass.POST_PASS, true);

            this._renderTransparents();
        }
        HX.popRenderTarget();

        HX.GL.disable(HX.GL.CULL_FACE);
        HX.GL.disable(HX.GL.DEPTH_TEST);

        this._renderToScreen(dt);

        if (HX._renderTargetStack.length > stackSize) throw "Unpopped render targets!";
        if (HX._renderTargetStack.length < stackSize) throw "Overpopped render targets!";
    },

    _renderShadowCasters: function ()
    {
        if (HX.MaterialPass.SHADOW_MAP_PASS === -1)
            HX.GL.colorMask(false, false, false, false);

        var casters = this._renderCollector.getShadowCasters();
        var len = casters.length;

        for (var i = 0; i < len; ++i) {
            casters[i].render(this._camera, this._scene)
        }

        if (HX.MaterialPass.SHADOW_MAP_PASS === -1)
            HX.GL.colorMask(true, true, true, true);
    },

    _renderOpaques: function ()
    {
        HX.GL.viewport(0, 0, this._width, this._height);

        HX.GL.enable(HX.GL.STENCIL_TEST);
        HX.GL.stencilOp(HX.GL.REPLACE, HX.GL.KEEP, HX.GL.REPLACE);
        HX.GL.clearColor(0, 0, 0, 1);
        this._renderToGBuffer();
        HX.GL.disable(HX.GL.STENCIL_TEST);
        this._linearizeDepth();

        HX.GL.disable(HX.GL.BLEND);

        // only render AO for non-transparents
        if (this._aoEffect !== null) {
            this._aoEffect.render(this, 0);

            // AO may have scaled down
            HX.GL.viewport(0, 0, this._width, this._height);
        }

        // no other lighting models are currently supported:
        HX.GL.enable(HX.GL.STENCIL_TEST);
        HX.GL.stencilOp(HX.GL.KEEP, HX.GL.KEEP, HX.GL.KEEP);

        var lightingModelID = 1;
        var stencilValue = lightingModelID << 1;
        HX.GL.stencilFunc(HX.GL.EQUAL, stencilValue, 0xff);

        this._renderLightAccumulation();

        HX.GL.disable(HX.GL.STENCIL_TEST);
    },

    _renderTransparents: function ()
    {
        var renderLists = [];

        var passIndices = HX.EXT_DRAW_BUFFERS
            ? [HX.MaterialPass.GEOMETRY_PASS]
            : [HX.MaterialPass.GEOMETRY_COLOR_PASS, HX.MaterialPass.GEOMETRY_NORMAL_PASS, HX.MaterialPass.GEOMETRY_SPECULAR_PASS];
        var numPassTypes = passIndices.length;

        for (var j = 0; j < numPassTypes; ++j) {
            renderLists[j] = this._renderCollector.getTransparentRenderList(passIndices[j]);
        }

        var baseList = renderLists[0];
        var len = baseList.length;

        HX.GL.enable(HX.GL.STENCIL_TEST);

        // TODO: Should we render all transparent objects with the same transparency mode?
        for (var i = 0; i < len; ++i) {
            var material = baseList[i].material;
            var transparencyMode = material._transparencyMode;

            var stencilValue = (material._lightingModelID << 1) | transparencyMode;
            HX.GL.stencilFunc(HX.GL.ALWAYS, stencilValue, 0xff);
            HX.GL.stencilOp(HX.GL.REPLACE, HX.GL.KEEP, HX.GL.REPLACE);

            if (HX.EXT_DRAW_BUFFERS)
                HX.pushRenderTarget(this._gbufferFBO);

            for (var j = 0; j < numPassTypes; ++j) {

                if (!HX.EXT_DRAW_BUFFERS)
                    HX.pushRenderTarget(this._gbufferSingleFBOs[j]);

                var passType = passIndices[j];
                var renderItem = renderLists[j][i];

                var meshInstance = renderItem.meshInstance;
                var pass = renderItem.pass;

                pass._shader.updateRenderState(renderItem.worldMatrix, renderItem.camera);
                HX.RenderUtils.switchPass(this, null, pass);
                meshInstance.updateRenderState(passType);

                HX.GL.drawElements(pass._elementType, meshInstance._mesh.numIndices(), HX.GL.UNSIGNED_SHORT, 0);

                if (!HX.EXT_DRAW_BUFFERS)
                    HX.popRenderTarget();
            }

            if (HX.EXT_DRAW_BUFFERS)
                HX.popRenderTarget();

            HX.GL.stencilFunc(HX.GL.EQUAL, stencilValue, 0xff);
            HX.GL.stencilOp(HX.GL.KEEP, HX.GL.KEEP, HX.GL.KEEP);

            this._linearizeDepth();

            HX.pushRenderTarget(this._hdrBack.fboDepth);
            this._renderLightAccumulation();
            HX.popRenderTarget();

            HX.GL.enable(HX.GL.BLEND);
            HX.GL.blendEquation(HX.GL.FUNC_ADD);

            switch (transparencyMode) {
                case HX.TransparencyMode.ADDITIVE:
                    HX.GL.blendFunc(HX.GL.ONE, HX.GL.ONE);
                    this._copyTexture.execute(HX.DEFAULT_RECT_MESH, this._hdrBack.texture);
                    break;
                case HX.TransparencyMode.ALPHA:
                    HX.GL.blendFunc(HX.GL.SRC_ALPHA, HX.GL.ONE_MINUS_SRC_ALPHA);
                    this._applyAlphaTransparency.execute(HX.DEFAULT_RECT_MESH, this._hdrBack.texture, this._gbuffer[0]);
                    break;
            }

            HX.popRenderTarget();

            HX.GL.disable(HX.GL.BLEND);
        }

        HX.GL.disable(HX.GL.STENCIL_TEST);
    },

    _renderToGBuffer: function ()
    {
        if (HX.EXT_DRAW_BUFFERS)
            this._renderToGBufferMRT();
        else
            this._renderToGBufferMultiPass();
    },

    _renderToGBufferMRT: function ()
    {
        HX.pushRenderTarget(this._gbufferFBO);
        HX.GL.clear(HX.GL.COLOR_BUFFER_BIT | HX.GL.DEPTH_BUFFER_BIT | HX.GL.STENCIL_BUFFER_BIT);
        this._renderPass(HX.MaterialPass.GEOMETRY_PASS);
        HX.popRenderTarget();
    },

    _renderToGBufferMultiPass: function ()
    {
        var clearMask = HX.GL.COLOR_BUFFER_BIT | HX.GL.DEPTH_BUFFER_BIT | HX.GL.STENCIL_BUFFER_BIT;
        var passIndices = [HX.MaterialPass.GEOMETRY_COLOR_PASS, HX.MaterialPass.GEOMETRY_NORMAL_PASS, HX.MaterialPass.GEOMETRY_SPECULAR_PASS];

        for (var i = 0; i < 3; ++i) {
            HX.pushRenderTarget(this._gbufferSingleFBOs[i]);
            HX.GL.clear(clearMask);
            this._renderPass(passIndices[i]);

            if (i == 0) {
                clearMask = HX.GL.COLOR_BUFFER_BIT;
                // important to use the same clip space calculations for all!
                HX.GL.depthFunc(HX.GL.EQUAL);
            }
            HX.popRenderTarget();
        }
    },

    _linearizeDepth: function ()
    {
        HX.GL.disable(HX.GL.DEPTH_TEST);
        HX.GL.disable(HX.GL.CULL_FACE);

        HX.pushRenderTarget(this._linearDepthFBO);
        this._linearizeDepthShader.execute(HX.DEFAULT_RECT_MESH, HX.EXT_DEPTH_TEXTURE ? this._depthBuffer : this._gbuffer[1], this._camera);
        HX.popRenderTarget(this._linearDepthFBO);
    },

    _renderEffect: function (effect, dt)
    {
        this._gammaApplied = this._gammaApplied || effect._outputsGamma;
        effect.render(this, dt);
    },

    _renderToScreen: function (dt)
    {
        switch (this._debugMode) {
            case HX.DebugRenderMode.DEBUG_COLOR:
                this._copyTexture.execute(HX.DEFAULT_RECT_MESH, this._gbuffer[0]);
                break;
            case HX.DebugRenderMode.DEBUG_NORMALS:
                this._debugNormals.execute(HX.DEFAULT_RECT_MESH, this._gbuffer[1]);
                break;
            case HX.DebugRenderMode.DEBUG_METALLICNESS:
                this._copyXChannel.execute(HX.DEFAULT_RECT_MESH, this._gbuffer[2]);
                break;
            case HX.DebugRenderMode.DEBUG_SPECULAR_NORMAL_REFLECTION:
                this._copyYChannel.execute(HX.DEFAULT_RECT_MESH, this._gbuffer[2]);
                break;
            case HX.DebugRenderMode.DEBUG_ROUGHNESS:
                this._copyZChannel.execute(HX.DEFAULT_RECT_MESH, this._gbuffer[2]);
                break;
            case HX.DebugRenderMode.DEBUG_DEPTH:
                this._debugDepth.execute(HX.DEFAULT_RECT_MESH, this._gbuffer[3]);
                break;
            case HX.DebugRenderMode.DEBUG_LIGHT_ACCUM:
                this._applyGamma.execute(HX.DEFAULT_RECT_MESH, this._hdrFront.texture);
                break;
            case HX.DebugRenderMode.DEBUG_AO:
                if (this._aoEffect)
                    this._copyWChannel.execute(HX.DEFAULT_RECT_MESH, this._aoTexture);
                break;
            case HX.DebugRenderMode.DEBUG_SSR:
                if (this._ssrEffect)
                    this._copyTexture.execute(HX.DEFAULT_RECT_MESH, this._ssrTexture);
                break;
            default:
                this._composite(dt);
        }
    },

    _composite: function (dt)
    {
        HX.pushRenderTarget(this._hdrFront.fbo);
            this._renderEffects(dt, this._renderCollector._effects);
        HX.popRenderTarget();

        // TODO: render directly to screen if last post process effect?
        // OR, provide toneMap property on camera, which gets special treatment
        if (this._gammaApplied)
            this._copyTextureToScreen.execute(HX.DEFAULT_RECT_MESH, this._hdrFront.texture);
        else
            this._applyGamma.execute(HX.DEFAULT_RECT_MESH, this._hdrFront.texture);
    },

    _renderLightAccumulation: function ()
    {
        HX.GL.disable(HX.GL.CULL_FACE);
        HX.GL.disable(HX.GL.DEPTH_TEST);
        HX.GL.depthMask(false);

        HX.GL.enable(HX.GL.BLEND);
        HX.GL.blendFunc(HX.GL.ONE, HX.GL.ONE);
        HX.GL.blendEquation(HX.GL.FUNC_ADD);

        HX.GL.clear(HX.GL.COLOR_BUFFER_BIT);
        this._renderDirectLights();
        this._renderGlobalIllumination();

        HX.GL.disable(HX.GL.BLEND);
        HX.GL.depthMask(true);
    },

    _renderDirectLights: function ()
    {
        var lights = this._renderCollector.getLights();
        var len = lights.length;

        var i = 0;

        while (i < len)
            i = lights[i].renderBatch(lights, i, renderer);
    },

    _renderGlobalIllumination: function ()
    {
        HX.GL.disable(HX.GL.CULL_FACE);

        if (this._renderCollector._globalIrradianceProbe)
            this._renderCollector._globalIrradianceProbe.render(this);

        if (this._ssrEffect != null) {
            HX.GL.disable(HX.GL.BLEND);
            this._ssrEffect.sourceTexture = HX.getCurrentRenderTarget()._colorTextures[0];
            this._ssrEffect.render(this, 0);
            HX.GL.enable(HX.GL.BLEND);
        }

        if (this._renderCollector._globalSpecularProbe)
            this._renderCollector._globalSpecularProbe.render(this);
        else if (this._ssrEffect) {
            HX.GL.blendFunc(HX.GL.SRC_ALPHA, HX.GL.ONE);
            this._copyTexture.execute(HX.DEFAULT_RECT_MESH, this._ssrTexture);
        }
    },

    _renderPass: function (passType, renderItems)
    {
        renderItems = renderItems || this._renderCollector.getOpaqueRenderList(passType);

        HX.RenderUtils.renderPass(this, passType, renderItems);
    },

    _copySource: function ()
    {
        HX.pushRenderTarget(HX.pushRenderTarget(this._hdrBack.fbo));
        HX.GL.disable(HX.GL.BLEND);
        HX.GL.disable(HX.GL.DEPTH_TEST);
        HX.GL.disable(HX.GL.CULL_FACE);
        this._copyTexture.execute(HX.DEFAULT_RECT_MESH, this._hdrFront.texture);
        HX.popRenderTarget();
    },

    _renderPostPass: function (passType, copySource)
    {
        HX.GL.disable(HX.GL.STENCIL_TEST);

        var opaqueList = this._renderCollector.getOpaqueRenderList(passType);
        var transparentList = this._renderCollector.getTransparentRenderList(passType);

        if (opaqueList.length === 0 && transparentList.length === 0)
            return;

        if (copySource)
            this._copySource();

        HX.GL.enable(HX.GL.CULL_FACE);
        HX.GL.enable(HX.GL.DEPTH_TEST);
        HX.GL.depthFunc(HX.GL.LEQUAL);

        this._renderPass(passType, this._renderCollector.getOpaqueRenderList(passType));
        this._renderPass(passType, this._renderCollector.getTransparentRenderList(passType));
    },

    _renderEffects: function (dt, effects)
    {
        if (!effects || effects.length == 0)
            return;

        HX.GL.disable(HX.GL.DEPTH_TEST);
        HX.GL.disable(HX.GL.CULL_FACE);

        var len = effects.length;

        for (var i = 0; i < len; ++i) {
            var effect = effects[i];
            if (effect.isSupported()) {
                this._renderEffect(effect, dt);
            }
        }
    },

    _createGBuffer: function ()
    {
        if (HX.EXT_DEPTH_TEXTURE) {
            this._depthBuffer = new HX.Texture2D();
            this._depthBuffer.setFilter(HX.TextureFilter.BILINEAR_NOMIP);
            this._depthBuffer.setWrapMode(HX.TextureWrapMode.CLAMP);
        }
        else {
            this._depthBuffer = new HX.ReadOnlyDepthBuffer();
        }

        this._gbuffer = [];

        for (var i = 0; i < 4; ++i) {
            this._gbuffer[i] = new HX.Texture2D();
            this._gbuffer[i].setFilter(HX.TextureFilter.BILINEAR_NOMIP);
            this._gbuffer[i].setWrapMode(HX.TextureWrapMode.CLAMP);
        }

        this._gbufferSingleFBOs = [];

        for (var i = 0; i < 3; ++i)
            this._gbufferSingleFBOs[i] = new HX.FrameBuffer([this._gbuffer[i]], this._depthBuffer);

        this._createGBufferFBO();
        this._linearDepthFBO = new HX.FrameBuffer(this._gbuffer[3], null);
    },

    _createGBufferFBO: function ()
    {
        if (HX.EXT_DRAW_BUFFERS) {
            var targets = [this._gbuffer[0], this._gbuffer[1], this._gbuffer[2]];
            this._gbufferFBO = new HX.FrameBuffer(targets, this._depthBuffer);
        }
    },

    _updateGBuffer: function (width, height)
    {
        if (HX.EXT_DEPTH_TEXTURE)
            this._depthBuffer.initEmpty(width, height, HX.GL.DEPTH_STENCIL, HX.EXT_DEPTH_TEXTURE.UNSIGNED_INT_24_8_WEBGL);
        else
            this._depthBuffer.init(width, height);

        for (var i = 0; i < this._gbuffer.length; ++i) {
            this._gbuffer[i].initEmpty(width, height, HX.GL.RGBA, HX.GL.UNSIGNED_BYTE);
        }

        for (var i = 0; i < this._gbufferSingleFBOs.length; ++i)
            this._gbufferSingleFBOs[i].init();

        this._updateGBufferFBO();
        this._linearDepthFBO.init();
    },

    _updateGBufferFBO: function ()
    {
        if (HX.EXT_DRAW_BUFFERS)
            this._gbufferFBO.init();
    },

    dispose: function ()
    {
        this._applyGamma.dispose();
        this._copyTexture.dispose();
        this._copyXChannel.dispose();
        this._copyYChannel.dispose();
        this._copyZChannel.dispose();
        this._copyWChannel.dispose();

        this._hdrBack.dispose();
        this._hdrFront.dispose();

        for (var i = 0; i < this._gbuffer.length; ++i)
            this._gbuffer[i].dispose();

        for (var i = 0; i < this._gbufferSingleFBOs.length; ++i)
            this._gbufferSingleFBOs[i].dispose();

        if (this._gbufferFBO)
            this._gbufferFBO.dispose();
    },

    // allows effects to ping pong on the renderer's own buffers
    _swapHDRFrontAndBack: function()
    {
        var tmp = this._hdrBack;
        this._hdrBack = this._hdrFront;
        this._hdrFront = tmp;
        HX.popRenderTarget();
        HX.pushRenderTarget(this._hdrFront.fbo);
    }
};