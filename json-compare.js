_ = require("underscore");

function compare(var1, var2, conf) {
    if (toString.call(var1) == '[object Array]' && toString.call(var2) == '[object Array]') {
        return arrayComp(var1, var2, conf ? conf : {})[0];
    } else if (toString.call(var1) == '[object Object]' && toString.call(var2) == '[object Object]') {
        return objectComp(var1, var2, conf ? conf : {})[0];
    } else {
        return null; 
    }       
    
}

// Match the current key with the current config branch and return new sublevel config
function get_subconf(conf, key) {
    if (toString.call(conf) == '[object Array]') return {};
    // Obtain config for current key
    var conf_values = _.filter(conf, function(v, k) {
        if (res = k.match(/^\/(.*?)\/$/)) {
          return key.match(new RegExp(res[1]));
        } else {
          return k == key;
        }
    });
    
    var conf_keys = _.uniq(_.flatten(_.map(conf_values, function(val) {return _.keys(val)})));
                                              
    var subconf = {};
    _.each(conf_keys, function(key) {
        subconf[key] = _.compact(_.flatten(_.map(conf_values ,function(val) {
            return _.has(val,key) ? val[key] : null;
        })));
        if (subconf[key].length > 0 && toString.call(subconf[key][0]) == '[object Object]') {
          subconf[key] = subconf[key][0];
        }
    });
    
    return subconf;
}

// Compare objects
function objectComp(obj1, obj2, conf) {
    var result = {t:'o',a:{},d:{},m:{},b:{}};
    var status = 'equal';
    
    // Omit conf keys that start with - (considered as commented out)
    _.each(conf, function(val,key) {if (key.match(/^-/)) {delete conf[key]}});
    
    _.each(_.union(_.keys(obj1), _.keys(obj2)), function(key) {
        
        var subconf = get_subconf(conf, key);
        
        // ignore some keys
        if (_.has(conf,'$ignore')) {
            if (_.isArray(conf.$ignore) && _.indexOf(conf.$ignore,key) > -1 || conf.$ignore === key) {
              return;
            }
        }
        
        //
        if (!_.has(obj1, key) && _.has(obj2, key)) {
            result.a[key] = obj2[key];
            status = 'changed';
        } else if (_.has(obj1, key) && !_.has(obj2, key)) {
            result.d[key] = obj1[key];
            status = 'changed';
        } else { 
            
            if (subconf.$arrayify) {
                obj1[key] = _.isArray(obj1[key]) ? obj1[key] : [obj1[key]];
                obj2[key] = _.isArray(obj2[key]) ? obj2[key] : [obj2[key]];
            }
            
            result.subconf = subconf;
                        
            // Check if values are of different type
            if (toString.call(obj1[key]) != toString.call(obj2[key])) {
                result.m[key] = [obj1[key], obj2[key]];
                status = 'changed';
                return;                
            }                
            
            // TODO: Replace 'switch' with docomp function            
            switch (toString.call(obj1[key])) {
                case '[object Object]':
                    var res = objectComp(obj1[key], obj2[key], subconf);
                    if (res[1] != 'equal') {
                        result.b[key] = res[0];
                        status = 'changed';
                    }                        
                    break;
                case '[object Array]':
                    var res = arrayComp(obj1[key], obj2[key], subconf);
                    if (res[1] != 'equal') {
                        result.b[key] = res[0];
                        status = 'changed';
                    }
                    break;
                default:
                    if (!_.isEqual(obj1[key],obj2[key])) {
                        result.m[key] = [obj1[key], obj2[key]];
                        status = 'changed';
                    }
                    break;
            }
                    
        } // if both keys exist         
    }); // each key in objects
    
    // If a key is defined, use that to determine if objects are of the same entity
    if (_.has(conf, '$key') && status == 'changed') {
        var keys = conf.$key && _.isArray(conf.$key) ? conf.$key : [conf.$key];
        _.each(keys, function(k) {
            if ((!_.has(obj1,k) || !_.has(obj2,k) || !_.isEqual(obj1[k],obj2[k]))) {
                status = 'disparate';
            }
        });
    }
    return [result, status];
}

function arrayComp(arr1, arr2, conf) {
    var result = {t:'a',a:[],d:[],m:[],b:[]};
    var status = 'equal';
    
    var arr1 = _.clone(arr1);
    var arr2 = _.clone(arr2);
    
    for(var i=0;i<=arr1.length-1;i++) {
        var elem1 = arr1[i];
        for(var j=0;j<=arr2.length-1;j++) {
            var elem2 = arr2[j];
            var res = docomp(elem1, elem2, conf);
            if (res[1] != 'disparate') {
                if (res[1] == 'changed') {
                    status = 'changed';
                    result.m.push([elem1, elem2]);
                }
                delete arr1[i];
                delete arr2[j];
                break;
            }
        }
    }    

    _.each(arr2, function(elem) {
        result.a.push(elem);             
        status = 'changed';
    });
    _.each(arr1, function(elem) {
        result.d.push(elem);             
        status = 'changed';
    });            
    
    return [result, status];
}
                        
function docomp(var1, var2, conf) {
    if (toString.call(var1) == '[object Array]' && toString.call(var2) == '[object Array]') {
        return arrayComp(var1, var2, conf !== undefined ? conf : {});
    } else if (toString.call(var1) == '[object Object]' && toString.call(var2) == '[object Object]') {
        return objectComp(var1, var2, conf !== undefined ? conf : {});
    } else {
        return [null, _.isEqual(var1, var2) ? 'equal' : 'disparate'];
    }        
}

// Merge diffs into a snapshot by annotating it
function diffAnnotate(tree, diff, prefix) {
  prefix = prefix || '$';
  var result;
  var tree = _.clone(tree);
  if (diff.t == 'a') {
    tree = _.isArray(tree) ? tree : [tree];
  }
  if (_.isArray(tree)) {
    result = [];
    if (diff.d) {tree = _.union(tree, diff.d)};
    var modid = 0;
    _.each(tree, function(val) {
      var item = _.clone(val);
      if (inArray(diff.a, val)) {
        setKey(item, prefix+"added", true);
      } else if (inArray(diff.d, val)) {
        setKey(item, prefix+"deleted", true);
      } else if (inArray(diff.b, val)) {
        setKey(item, prefix+"updated", true);
      } else if (inArray(_.map(diff.m, function(val) {return val[1]}), val)) {
        modid++;
        console.log("mod", val, diff.m);
        setKey(item, prefix+"added", true);
        setKey(item, prefix+"modid", modid);
        var oldval = _.find(diff.m, function(mod) {
          return _.isEqual(mod[1], val);
        })[0];
        setKey(oldval, prefix+"deleted", oldval);
        setKey(oldval, prefix+"modid", modid);
        result.push(oldval);
        //setKey(item, prefix+"oldval", oldval);
      }
      result.push(item);
    });
  } else { // object
    result = {};
    if (diff.d) {tree = _.extend(tree, diff.d)};
    _.each(tree, function(val, key) {
      var item = _.clone(val);
      if (_.has(diff.a, key)) {
        setKey(item, prefix+"added", true);
      } else if (_.has(diff.d, key)) {
        setKey(item, prefix+"deleted", true);
      } else if (_.has(diff.b, key)) {
        item = diffAnnotate(item, diff.b[key]);
        setKey(item, prefix+"updated", true);
      } else if (_.has(diff.m, key)) {
        setKey(item, prefix+"added", true);
        setKey(item, prefix+"oldval", diff.m[key][0]);
      }
      result[key] = item;
    });    
  }
  return result;
  
  function inArray(haystack, needle) {
    return _.find(haystack, function(item) {
      return _.isEqual(item, needle);
    });
  }
  
  function setKey(item, key, val) {
    if (_.isArray(item)) {
      //_.each(item, function(it) {
      //  setKey(it, key, val);
      //});
    } else if (_.isObject(item)) {
      item[key] = val;
    }
  }
} 

exports.compare = compare;
exports.diffAnnotate = diffAnnotate;
