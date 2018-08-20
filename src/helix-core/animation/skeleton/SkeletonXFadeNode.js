import {AnimationClip} from "./../AnimationClip";
import {SkeletonClipNode} from "./SkeletonClipNode";
import {SkeletonBlendNode} from "./SkeletonBlendNode";
import {MathX} from "../../math/MathX";

/**
 * SkeletonXFadeNode is a {@linkcode SkeletonBlendNode} for simple cross-fading between child animation clips.
 *
 * @constructor
 *
 * @extends  SkeletonBlendNode
 *
 * @author derschmale <http://www.derschmale.com>
 */
function SkeletonXFadeNode()
{
    SkeletonBlendNode.call(this);
    this._children = [];
    this._numJoints = 0;
    this._clips = {};

    // TODO: Add the possibility to sync times, useful for syncing walk -> run!
    // in this case, the clips should have their timesteps recalculated
}

SkeletonXFadeNode.prototype = Object.create(SkeletonBlendNode.prototype, {
    /**
     * @ignore
     */
    numJoints: {
        get: function() { return this._numJoints; }
    }
});

/**
 * This adds a clip that can be triggered by name in fadeTo.
 */
SkeletonXFadeNode.prototype.addClip = function(clip)
{
    this._clips[clip.name] = clip;
};

/**
 * @classdesc
 * Cross-fades the animation to a new target animation.
 * @param node A {@linkcode SkeletonBlendTreeNode}, an {@linkcode AnimationClip}, or a string with the name of a clip.
 * If using a string, the clip has to be added using {@linkcode addClip}.
 * @param time The time the fade takes in milliseconds.
 * @param [sync] An optional flag to make clips sync to eachother. All clips with sync = true will be synced, others will
 * run independently. This only works if node is a (name of a) clip.
 */
SkeletonXFadeNode.prototype.fadeTo = function(node, time, sync)
{
    // immediately replace
    if (time === 0 && node.looping === false) {
        this._children = [];
    }

    if (node instanceof String) node = new SkeletonClipNode(this._clips[node]);
    else if (node instanceof AnimationClip) node = new SkeletonClipNode(node);

    this._numJoints = node.numJoints;
    // put the new one in front, it makes the update loop more efficient
    this._children.unshift({
        node: node,
        // make sure that these are immediately replaced
        weight: time === 0? 1.0 : 0.0,
        fadeSpeed: time === 0? 10000.0 : 1 / time,
        sync: sync
    });
};

/**
 * @ignore
 */
SkeletonXFadeNode.prototype.update = function(dt, transferRootJoint)
{
    var len = this._children.length;

    var syncedDuration = 0;
    var totalWeight = 0;
    var refChild = undefined;
    for (i = len - 1; i >= 0; --i) {
        var child = this._children[i];
        var childNode = child.node;
        if (child.sync) {
            // the oldest clip defines the playhead position
            refChild = refChild || child;
            syncedDuration += child.node.duration * child.weight;
            totalWeight += child.weight;
        }
    }
    if (totalWeight !== 0.0)
        syncedDuration /= totalWeight;

    if (refChild) {
        var syncedPlaybackRate = refChild.duration / syncedDuration;
        var syncRatio = (refChild.time + dt * syncedPlaybackRate) / refChild.duration;
    }

    // we're still fading if len > 1
    var updated = len > 1 && dt > 0;

    // update weights and remove any node that's become unused
    // do not interpolate the nodes into the pose yet, because if no updates occur, this is unnecessary
    for (var i = 0; i < len; ++i) {
        child = this._children[i];
        childNode = child.node;

        if (child.sync) {
            // could also figure out a playbackRate to apply to dt, but assigning time and updating with dt = 0 is more
            // robust.
            childNode.time = childNode.duration * syncRatio;
            updated = childNode.update(0, transferRootJoint) || updated;
        }
        else
            updated = childNode.update(dt, transferRootJoint) || updated;

        // handle one-shots:
        var w = child.weight + dt * child.fadeSpeed;
        if (childNode.looping === false) {
            // need to fade out a one-shot at the end
            var f = (childNode.duration - childNode.time) * child.fadeSpeed;
            if (f <= 1) {
                w *= f;
                // delete one-shot when it's done, but ONLY if there's other clips to be played
                if (f < .001 && len !== 1) {
                    // the next index will be i again
                    --len;
                    this._children.splice(i--, 1);
                }
            }
        }

        // if looping === undefined, it's a node, and it's considered "endless"
        if (w > .999 && childNode.looping !== false) {
            child.weight = 1.0;
            // we can safely remove any of the following child nodes, because their values will be lerped away
            this._children.splice(i + 1);
            break;
        }

        child.weight = w;
    }


    if (!updated) return false;


    var last = this._children.length - 1;

        // work backwards, so we can just override each old state progressively
    childNode = this._children[last].node;
    var delta = this._rootJointDeltaPosition;
    var pose = this._pose;
    pose.copyFrom(childNode._pose);

    if (transferRootJoint)
        delta.copyFrom(childNode._rootJointDeltaPosition);

    for (i = last - 1; i >= 0; --i) {
        child = this._children[i];
        childNode = child.node;

        if (transferRootJoint)
            delta.lerp(delta, childNode._rootJointDeltaPosition, child.weight);

        pose.interpolate(pose, childNode._pose, child.weight);
    }

    return true;
};

SkeletonClipNode.prototype._queryChildren = function(name)
{
    // this is a leaf node
    // (actually, internally it uses child nodes, but those are of no business to the user)
    return null;
};

export { SkeletonXFadeNode };