
// INSTANCE

var Instance = Backbone.Model.extend({

  initialize: function(inst) {

    var tags = {};
    if (inst.tagSet) {
      _.each(inst.tagSet.item ? getItems(inst.tagSet.item) : [], function(val) {
        tags[val.key] = val.value;
      });
    }
    
    var blockdevices = {};
    _.each(inst.blockDeviceMapping && inst.blockDeviceMapping.item ? getItems(inst.blockDeviceMapping.item) : [], function(val) {
      blockdevices[val.deviceName] = val;
    });
    
    var groups = inst.groupSet ? getItems(inst.groupSet.item, "groupId") : {};

    this.set({
      id: inst.instanceId,
      name: typeof tags['Name'] !== 'object' ? tags['Name'] : null,
      tags: tags,
      blockdevices: blockdevices,
      secgroups: groups
    });
  }
  
});

var Instances = Backbone.Collection.extend({

  model: Instance,  
  
  // Sets locally stored data
  setLocal: function(inst_info) {
    var self = this;
    _.each(inst_info, function(val, key) {
      self.get(key).set({local: val});
    });
  },
  
});

// SECGROUP

var Secgroup = Backbone.Model.extend({

  initialize: function(group) {
  
    var inbound = [];
    _.each(group.ipPermissions ? getItems(group.ipPermissions.item) : [], function(perm) {
      perm.groups = perm.groups ? getItems(perm.groups.item, "groupId") : {};
      perm.ipRanges = perm.ipRanges ? getItems(perm.ipRanges.item) : {};
      inbound.push(perm)
    });
    
    var outbound = [];
    _.each(group.ipPermissionsEgress ? getItems(group.ipPermissionsEgress.item) : [], function(perm) {
      perm.groups = perm.groups ? getItems(perm.groups.item, "groupId") : {};
      perm.ipRanges = perm.ipRanges ? getItems(perm.ipRanges.item) : {};
      outbound.push(perm)
    });     

    this.set({
      id: group.groupId,
      name: group.groupName,
      desc: group.groupDescription,
      inbound: inbound,
      outbound: outbound
    });
  },
  
});

var Secgroups = Backbone.Collection.extend({

  model: Secgroup,
  
  comparator: function(group) {
    return group.get("name");
  }
  
});

// utils

function getItems(obj, key) {
  var result;
  if (key) {
    result = {};
    _.each(_.compact($.isArray(obj) ? obj : [obj]), function(item) {
      result[item[key]] = item;
    });    
  } else {
    result = [];
    _.each(_.compact($.isArray(obj) ? obj : [obj]), function(item) {
      result.push(item);
    });
  }
  return result;
}
