import {capabilities, Comparison, CullMode, DEFAULTS} from "../Helix";
import {TextureSetter} from "../shader/TextureSetter";
import {GL} from "../core/GL";
import {TextureSlot} from "./TextureSlot";
import {UniformBufferSlot} from "./UniformBufferSlot";
import {Texture2D} from "../texture/Texture2D";
import {UniformBufferSetter} from "../shader/UniformBufferSetter";
import {UniformBuffer} from "../core/UniformBuffer";

/**
 * @ignore
 * @param shader
 * @constructor
 *
 * @author derschmale <http://www.derschmale.com>
 */
function MaterialPass(shader)
{
    this.shader = shader;
    this._textureSlots = shader.createTextureSlots();
    this._uniformBufferSlots = shader.createUniformBufferSlots();
    this.cullMode = CullMode.BACK;
    this.writeColor = true;
    this.depthTest = Comparison.LESS_EQUAL;
    this.writeDepth = true;
    this.blendState = null;

    this._textureSettersPass = TextureSetter.getSettersPerPass(this);
    this._textureSettersInstance = TextureSetter.getSettersPerInstance(this);

    if (capabilities.WEBGL_2) {
        this._uniformBufferSettersPass = UniformBufferSetter.getSettersPerPass(this);
        this._uniformBufferSettersInstance = UniformBufferSetter.getSettersPerInstance(this);
    }

    this.setTexture("hx_dither2D", DEFAULTS.DEFAULT_2D_DITHER_TEXTURE);
}

// these will be set upon initialization
// if a shader supports multiple lights per pass, they will take up 3 type slots (fe: 3 point lights: POINT_LIGHT_PASS, POINT_LIGHT_PASS + 1, POINT_LIGHT_PASS + 2)
MaterialPass.BASE_PASS = 0;  // used for unlit, for predefined lights, or for WebGL 2 dynamic  passes

MaterialPass.NORMAL_DEPTH_PASS = 1;

// shadow map generation
MaterialPass.DIR_LIGHT_SHADOW_MAP_PASS = 2;
MaterialPass.POINT_LIGHT_SHADOW_MAP_PASS = 3;

// dynamic lighting passes
MaterialPass.DIR_LIGHT_PASS = 4;
MaterialPass.POINT_LIGHT_PASS = 5;
MaterialPass.SPOT_LIGHT_PASS = 6;
MaterialPass.LIGHT_PROBE_PASS = 7;

MaterialPass.NUM_PASS_TYPES = 8;

MaterialPass.prototype =
    {
        constructor: MaterialPass,

        /**
         * Called per render item.
         */
        updateInstanceRenderState: function(camera, renderItem)
        {
            var len = this._textureSettersInstance.length;

            for (var i = 0; i < len; ++i) {
                this._textureSettersInstance[i].execute(renderItem);
            }

            if (this._uniformBufferSettersInstance) {
                len = this._uniformBufferSettersInstance.length;

                for (i = 0; i < len; ++i) {
                    this._uniformBufferSettersInstance[i].execute(renderItem);
                }
            }

            this.shader.updateInstanceRenderState(camera, renderItem);
        },

        /**
         * Only called upon activation, not per render item.
         */
        updatePassRenderState: function (camera, renderer, data)
        {
            var len = this._textureSettersPass.length;
            var i;
            for (i = 0; i < len; ++i) {
                this._textureSettersPass[i].execute(renderer);
            }

            if (this._uniformBufferSettersPass) {
                len = this._uniformBufferSettersPass.length;
                for (i = 0; i < len; ++i) {
                    this._uniformBufferSettersPass[i].execute(renderer);
                }
            }

            len = this._textureSlots.length;

            for (i = 0; i < len; ++i) {
                var slot = this._textureSlots[i];
                var texture = slot.texture;

                if (!texture) {
                    Texture2D.DEFAULT.bind(slot.index);
                    continue;
                }

                if (texture.isReady())
                    texture.bind(slot.index);
                else
                    texture._default.bind(slot.index);
            }

            len = this._uniformBufferSlots.length;

            for (i = 0; i < len; ++i) {
                slot = this._uniformBufferSlots[i];
                var buffer = slot.buffer;
                buffer.bind(i);
            }

            GL.setMaterialPassState(this.cullMode, this.depthTest, this.writeDepth, this.writeColor, this.blendState);

            this.shader.updatePassRenderState(camera, renderer);
        },

        getTextureSlot: function(slotName)
        {
			if (!this.shader.hasUniform(slotName)) return;

			var slots = this._textureSlots;

            for (var i = 0, len = slots.length; i < len; ++i) {
                if (slots[i].name === slotName)
                    return slots[i];
            }

            return null;
        },

        getUniformBufferSlot: function(slotName)
        {
            for (var i = 0, len = this._uniformBufferSlots.length; i < len; ++i) {
                var slot = this._uniformBufferSlots[i];
                if (slot.name === slotName)
                    return slot;
            }

            return null;
        },

        setTexture: function(slotName, texture)
        {
            var slot = this.getTextureSlot(slotName);
            if (slot)
                slot.texture = texture;
        },

        setUniformBuffer: function(slotName, buffer)
        {
            var slot = this.getUniformBufferSlot(slotName);
            if (slot)
                slot.buffer = buffer;
        },

        setTextureArray: function(slotName, textures)
        {
            var firstSlot = this.getTextureSlot(slotName + "[0]");
            var location = firstSlot.location;

            if (firstSlot) {
                var len = textures.length;
                for (var i = 0; i < len; ++i) {
                    var slot = this._textureSlots[firstSlot.index + i];
                    // make sure we're not overshooting the array and writing to another element (larger arrays are allowed analogous to uniform arrays)
                    if (!slot || slot.location !== location) return;
                    slot.texture = textures[i];
                }
            }
        },

        getUniformLocation: function(name)
        {
            return this.shader.getUniformLocation(name);
        },

        getAttributeLocation: function(name)
        {
            return this.shader.getAttributeLocation(name);
        },

        // slow :(
        setUniformStructArray: function(name, value)
        {
            var len = value.length;
            for (var i = 0; i < len; ++i) {
                var elm = value[i];
                for (var key in elm) {
                    if (elm.hasOwnProperty(key))
                        this.setUniform(name + "[" + i + "]." + key, value);
                }
            }
        },

        setUniformArray: function(name, value)
        {
            name += "[0]";

            if (!this.shader.hasUniform(name))
                return;

            var uniform = this.shader.getUniform(name);
            var gl = GL.gl;
            gl.useProgram(this.shader.program);

            switch(uniform.type) {
                case gl.FLOAT:
                    gl.uniform1fv(uniform.location, value);
                    break;
                case gl.FLOAT_VEC2:
                    gl.uniform2fv(uniform.location, value);
                    break;
                case gl.FLOAT_VEC3:
                    gl.uniform3fv(uniform.location, value);
                    break;
                case gl.FLOAT_VEC4:
                    gl.uniform4fv(uniform.location, value);
                    break;
                case gl.FLOAT_MAT4:
                    gl.uniformMatrix4fv(uniform.location, false, value);
                    break;
                case gl.INT:
                    gl.uniform1iv(uniform.location, value);
                    break;
                case gl.INT_VEC2:
                    gl.uniform2iv(uniform.location, value);
                    break;
                case gl.INT_VEC3:
                    gl.uniform3iv(uniform.location, value);
                    break;
                case gl.INT_VEC4:
                    gl.uniform1iv(uniform.location, value);
                    break;
                case gl.BOOL:
                    gl.uniform1bv(uniform.location, value);
                    break;
                case gl.BOOL_VEC2:
                    gl.uniform2bv(uniform.location, value);
                    break;
                case gl.BOOL_VEC3:
                    gl.uniform3bv(uniform.location, value);
                    break;
                case gl.BOOL_VEC4:
                    gl.uniform4bv(uniform.location, value);
                    break;
                default:
                    throw new Error("Unsupported uniform format for setting (" + uniform.type + ") for uniform '" + name + "'. May be a todo.");

            }
        },

        setUniform: function(name, value)
        {
            // TODO: Assign these on shader
            if (!this.shader.hasUniform(name))
                return;

            var uniform = this.shader.getUniform(name);

            var gl = GL.gl;
            gl.useProgram(this.shader.program);

            switch(uniform.type) {
                case gl.FLOAT:
                    gl.uniform1f(uniform.location, value);
                    break;
                case gl.FLOAT_VEC2:
                    gl.uniform2f(uniform.location, value.x || value[0] || 0, value.y || value[1] || 0);
                    break;
                case gl.FLOAT_VEC3:
                    gl.uniform3f(uniform.location, value.x || value.r || value[0] || 0, value.y || value.g || value[1] || 0, value.z || value.b || value[2] || 0 );
                    break;
                case gl.FLOAT_VEC4:
                    gl.uniform4f(uniform.location, value.x || value.r || value[0] || 0, value.y || value.g || value[1] || 0, value.z || value.b || value[2] || 0, value.w || value.a || value[3] || 0);
                    break;
                case gl.INT:
                    gl.uniform1i(uniform.location, value);
                    break;
                case gl.INT_VEC2:
                    gl.uniform2i(uniform.location, value.x || value[0], value.y || value[1]);
                    break;
                case gl.INT_VEC3:
                    gl.uniform3i(uniform.location, value.x || value[0], value.y || value[1], value.z || value[2]);
                    break;
                case gl.INT_VEC4:
                    gl.uniform4i(uniform.location, value.x || value[0], value.y || value[1], value.z || value[2], value.w || value[3]);
                    break;
                case gl.BOOL:
                    gl.uniform1i(uniform.location, value);
                    break;
                case gl.BOOL_VEC2:
                    gl.uniform2i(uniform.location, value.x || value[0], value.y || value[1]);
                    break;
                case gl.BOOL_VEC3:
                    gl.uniform3i(uniform.location, value.x || value[0], value.y || value[1], value.z || value[2]);
                    break;
                case gl.BOOL_VEC4:
                    gl.uniform4i(uniform.location, value.x || value[0], value.y || value[1], value.z || value[2], value.w || value[3]);
                    break;
                case gl.FLOAT_MAT4:
                    gl.uniformMatrix4fv(uniform.location, false, value._m);
                    break;
                default:
                    throw new Error("Unsupported uniform format for setting. May be a todo.");

            }
        }
    };

export { MaterialPass };