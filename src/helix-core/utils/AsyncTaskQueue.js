import {Signal} from "../core/Signal";

/**
 * AsyncTaskQueue allows queueing a bunch of functions which are executed "whenever", in order.
 *
 * @classdesc
 *
 * @ignore
 *
 * @constructor
 */
function AsyncTaskQueue()
{
    this.onComplete = new Signal();
    this._queue = [];
    this._currentIndex = 0;
    this._isRunning = false;
}

AsyncTaskQueue.prototype = {
    queue: function(func, rest)
    {
        // V8 engine doesn't perform well if not copying the array first before slicing
        var args = (arguments.length === 1 ? [arguments[0]] : Array.apply(null, arguments));

        this._queue.push({
            func: func,
            args: args.slice(1)
        });
    },

    runAll: function()
    {
        if (this._isRunning)
            throw new Error("Already running!");

        this._isRunning = true;
        this._currentIndex = 0;

        this._executeTask();
    },

    _executeTask: function()
    {
        setTimeout(this._executeImpl.bind(this));
    },

    _executeImpl: function()
    {
        if (this._queue.length === this._currentIndex) {
            this.onComplete.dispatch();
        }
        else {
            var elm = this._queue[this._currentIndex];
            elm.func.apply(this, elm.args);
            ++this._currentIndex;
            this._executeTask();
        }
    }
};

export { AsyncTaskQueue };