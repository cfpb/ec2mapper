var aws = require("aws-lib");
var fs = require("fs");
var mongo = require("mongodb");
var prettyjson = require("prettyjson");
var async = require("async");
var _ = require("underscore");

var cron = require('./cron');

// -------------------------------------------------------------------------

var settings = JSON.parse(fs.readFileSync(__dirname+"/server-settings.json"));

var mongo_server = new mongo.Server(settings.mongodb.host, settings.mongodb.port, {});

var ec2 = aws.createEC2Client(settings.aws.accessKey, settings.aws.secretKey, {
  version: "2011-12-15"
});

// Init MongoDB connection
var ec2db;
new mongo.Db(settings.mongodb.db, mongo_server, {}).open(function (error, client) {
  if (error) throw error;
  ec2db = client;
});

// Set up cron job to pull data once an hour, on the hour
new cron.CronJob(settings.fetchcron, function(){
  console.log(new Date(), "Fetching data...");
  fetchData();
});

if (process.getuid() == 0) {
  process.setuid('www-data');
}

// -------------------------------------------------------------------------


function fetchData() {

  var vpcs = {};
  var subnets = {};
  var instances = {};
  var secgroups = {};
  var acls = {};
  var rtables = {};
  
  async.auto({
  
    get_vpcs: function(cb) {
      ec2.call("DescribeVpcs", {}, function(result) {
        _.each(result.vpcSet ? result.vpcSet.item : [], function(vpc) {        
          if (vpc.vpcId) vpcs[vpc.vpcId] = vpc; 
        });      
        cb();
      });  
    },
    
    get_subnets: function(cb) {
      ec2.call("DescribeSubnets", {}, function(result) {
        _.each(result.subnetSet ? result.subnetSet.item : [], function(subnet) {        
          if (subnet.subnetId) subnets[subnet.subnetId] = subnet; 
        });      
        cb();
      });  
    },
    
    get_instances: function(cb) {
      ec2.call("DescribeInstances", {}, function(result) {
        _.each(result.reservationSet ? result.reservationSet.item : [], function(inst) {        
          var item = inst.instancesSet.item;
          if (item.instanceId) instances[item.instanceId] = item; 
        });      
        cb();
      });
    },
    
    get_secgroups: function(cb) {
      ec2.call("DescribeSecurityGroups", {}, function(result) {
        _.each(result.securityGroupInfo ? result.securityGroupInfo.item : [], function(secgrp) {        
          if (secgrp.groupId) secgroups[secgrp.groupId] = secgrp; 
        });      
        cb();
      });
    },
    
    get_acls: function(cb) {
      ec2.call("DescribeNetworkAcls", {}, function(result) {
        _.each(result.networkAclSet ? result.networkAclSet.item : [], function(acl) {        
          if (acl.networkAclId) acls[acl.networkAclId] = acl; 
        });      
        cb();
      });
    },
  
    get_routes: function(cb) {
      ec2.call("DescribeRouteTables", {}, function(result) {
        _.each(result.routeTableSet ? result.routeTableSet.item : [], function(rtable) {        
          if (rtable.routeTableId) rtables[rtable.routeTableId] = rtable; 
        });      
        cb();
      });
    },
  
    insert_data: ['get_vpcs', 'get_subnets', 'get_instances', 'get_secgroups', 'get_acls', 'get_routes', function(cb) {
    
      var record = {
        vpcs: vpcs,
        subnets: subnets,
        instances: instances,
        secgroups: secgroups,
        acls: acls,
        rtables: rtables,
        
        type: "amazon",
        datetime: new Date()      
      };
      
      var collection = new mongo.Collection(ec2db, 'snapshots');
      collection.insert(record, function(err, docs) {
        cb();
      });      
      
    }]
    
  }); // async.auto
  
}