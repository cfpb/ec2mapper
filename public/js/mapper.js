var vpc_info;
var inst_info;

// Kept for debugging from console, but app relies on the models
var snapshot;
var snapshot_diff;
var annotated;

// Backbone models
var secgroups;
var instances;

var activeTooltip = null;
var activeInstTooltip = null;

var current_vpc;

$(function() {

  async.auto({    
    vpc_info: function(cb) {
      $.getJSON(baseurl+"/vpc/info", function(result) {
        cb(null, result);
      });
    },
    inst_info: function(cb) {
/*
      $.getJSON(baseurl+"/instance/info", function(result) {
        cb(null, result);
      });
*/
      cb(null, {});
    },
    snapshot: function(cb) {
      $.getJSON(baseurl+"/snapshot/last", function(result) {
        cb(null, result);
      });
    },
    create_models: ["vpc_info", "inst_info", "snapshot", function(cb, res) {
      snapshot = res.snapshot;
      vpc_info = res.vpc_info;
      inst_info = res.inst_info;
      
      secgroups = new Secgroups(_.values(snapshot.secgroups));
      instances = new Instances(_.values(snapshot.instances));
      instances.setLocal(inst_info);
            
      cb();
    }],
    render: ["create_models", function(cb) {      
      populateVpcs();
      // get vpc_id or default to DevVPC at startup        
      loadVpc("vpc-1da65575");        
    }]      
  })
  
  // Initialize snapshot dropdown calendar
  $("#choose-date").kalendae({
    selected: Kalendae.moment(),
    months:2,
    direction:"today-past",
    mode:"range",
    format: "M/D",
    blackout: function(date) {
      // Snapshots start at 2/14
      return Kalendae.moment(date).valueOf() < Kalendae.moment("02-14-2012", "MM-DD-YYYY").valueOf();
    }
    
  }).data("kalendae").subscribe("change", function() {
    var selection = this.getSelected();
    var name = selection.match(/-/) ? "Difference" : "Snapshot";
    $("#date-dropdown").html(name+"&#x200A;&#x25b8;&nbsp;&nbsp;"+selection);
    var range = this.getSelectedRaw();

    clearTooltips();
    $("#client-area").hide();
    $("#loader").show();
    
    var last_date = _.last(range).format("YYYYMMDDHHmmss");
    
    async.auto({
      snapshot: function(cb) {
        $.getJSON(baseurl+"/snapshot/"+_.last(range).format("YYYYMMDD")+"235959", function(result) {
          snapshot = result;          
          cb(null, snapshot);
        });
      },      
      diff: ['snapshot', function(cb) {
        if (range.length>1) {
          $.getJSON(baseurl+"/diff/"+range[0].format("YYYYMMDD")+"000000/"+range[1].format("YYYYMMDD")+"235959", function(result) {
            snapshot_diff = result;
            cb(null, snapshot_diff)            
          });
        } else {
          cb(null, null); // No diff when single date selected
        }
      }],      
      annotate: ['snapshot', 'diff', function(cb, res) {
        if (res.diff) {
          annotated = diffAnnotate(res.snapshot, res.diff);
          cb(null, annotated);      
        } else {
          cb(null, res.snapshot);          
        }
      }],
      render: ['annotate', function(cb, res) {
      
        secgroups = new Secgroups(_.values(res.annotate.secgroups));
        instances = new Instances(_.values(res.annotate.instances));
        instances.setLocal(inst_info);
        
        // Propagate secgroup updates to instances/other_secgroups that reference them
        secgroups.each(function(group) {
          var sgrefs_in = _.map(_.pluck(group.get("inbound"), "groups"), function(item) {return _.keys(item)});
          var sgrefs_out = _.map(_.pluck(group.get("outbound"), "groups"), function(item) {return _.keys(item)});
          var sgchange = _.any(_.compact(_.flatten([sgrefs_in, sgrefs_out])), function(gid) {
            return secgroups.get(gid) && group.id != gid && secgroups.get(gid).get("$updated");
          });
          if (sgchange) {
            group.set("$sgchange", true);
          }
        });
        instances.each(function(inst) {
          var sgchange = _.any(_.keys(inst.get("secgroups")), function(gid) {
            var grp = secgroups.get(gid);
            return grp && (grp.get("$updated") || grp.get("$sgchange"));
          });
          if (sgchange) {
            inst.set("$sgchange", true);
          }
        });
        
        
        // TODO: propagate to other sec groups that reference
            
        populateVpcs();
        loadVpc(current_vpc);          
        $("#client-area").show();
        $("#loader").hide();
        cb();
      }]    
    });
    
  }); // on calendar change
  
  $('html').on('click', clearTooltips);
  
}); // on page load

// jQuery plugin highlights tooltip table rows based on item annotations
jQuery.fn.annotate = function(item) {
  if (item["$added"]) {            // add
    this.addClass("added").first().append("<i class='icon-plus-sign icon-white pull-left'></i>");
  } else if (item["$deleted"]) { // delete
    this.addClass("deleted").first().append("<i class='icon-minus-sign icon-white pull-left'></i>");
  } else if (item["$updated"]) { // modify
    this.addClass("updated").first().append("<i class='icon-edit icon-white pull-left'></i>");
  }
  if (item["$sgchange"]) {         // secgroup changed
    this.first().append("<i class='icon-exclamation-sign icon-white pull-left' style='opacity:0.6;'></i>");
  }
  return this;    
}

function clearTooltips() {
  if (activeTooltip) {
    if (typeof activeTooltip.data("activeTooltipTable").data("removeTooltip") == 'function') {
      activeTooltip.data("activeTooltipTable").data("removeTooltip")(); 
    }
    activeTooltip.tooltip("hide");
    activeTooltip = null;
  }  
  if (activeInstTooltip) {
    if (typeof activeInstTooltip.data("activeInstTooltipTable").data("removeTooltip") == 'function') {
      activeInstTooltip.data("activeInstTooltipTable").data("removeTooltip")(); 
    }
    activeInstTooltip.tooltip("hide");
    activeInstTooltip = null;
  }  
}

function loadVpc(vpc_id) {
  current_vpc = vpc_id;
  var name = vpc_info[vpc_id] !== undefined ? vpc_info[vpc_id].name : vpc_id;
  clearTooltips();
  $("#vpc-title").text(name);
  $("#public_instances tbody, #private_instances tbody").children().remove();
  populateInstances(vpc_id);
  populateSecurityGroups(vpc_id);
  $("#client-area").show();
  $("#loader").hide();
}

function populateVpcs() {
  var vpc_list = $("#vpc_list");
  vpc_list.children().filter(":not(.nav-header)").remove();
  var pcCallback = function(field_el, value) { 
    $.get(baseurl+"/vpc/info/setname/"+field_el.attr("vpc_id")+"/"+encodeURI(value)) 
  };
  _.each(snapshot.vpcs, function(value, key) {
    var name = vpc_info[key] !== undefined ? vpc_info[key].name : key;
    var a = $("<a href='#'/>").attr("vpc_id", key).text(name);
    a.click(function() {
      loadVpc(key);
    }).dblclick(function() {
      editField($(this), saveVpcCallback);
    });      
    var li = a.wrap("<li>").parent();
    vpc_list.append(li);
  });
}

// Accepts a Secgroup object and returns a rendered jQuery object to insert in tooltip
function renderSecGroupTooltipTable(group) {

  var table = $("<table class='table-tooltip'/>");
  table.append($("<tr/>").append($("<th colspan='2'/>").append($("<span style='color:#fff f00;font:normal 10px arial;'/>").text(group.get("groupDescription"))).append($("<span style='color:#999999;padding:6px;'/>").text("("+group.id+")"))));    
  
  // Render each individual rule along with its diff annotations
  var renderRule = function(rule, tr_class) {
    var port = rule.fromPort !== undefined ? (rule.fromPort === -1 ? "ANY" : rule.toPort !== undefined && rule.fromPort !== rule.toPort ? rule.fromPort+"-"+rule.toPort : rule.fromPort) : "ANY";
    port = rule.ipProtocol !== undefined && rule.ipProtocol != -1 ? rule.ipProtocol+"/"+port : port;

    // If rule chained from another sec group
    if (_.values(rule.groups).length > 0) { 
      _.each(_.keys(rule.groups), function(group_id) {
              
        var group = secgroups.get(group_id);
            
        // If we have a record for the subgroup
        if (group) {
          name_link = $("<a/>").text(group.get("name"));            
          
          name_link.tooltip({title: function() {
            var subdiv = renderSecGroupTooltipTable(group);
            var subtable = subdiv.find("table.table-tooltip");
            table.data("activeTooltip", $(this));
            table.data("activeTooltipTable", subtable);       
            return subdiv; 
          }, placement: "right", trigger: "manual"});
          
          name_link.click(function() {
            table.data("removeTooltip")();
            $(this).tooltip("show");
          });
        } else { // If name not available, show group id
          name_link = $("<span/>").text(group_id);
        }
        
        var tr = $("<tr/>").addClass(tr_class).append($("<td/>").append(name_link)).append($("<td/>").text(port));
                
        tr.find("td").annotate(group.toJSON())
        table.append(tr);
      }); // foreach chained secgroup
              
    } else { // If CIDR block(s)
      _.each(rule.ipRanges, function(range) {
        cidr = range.cidrIp == "0.0.0.0/0" ? "ALL" : range.cidrIp;
        var tr = $("<tr/>").addClass(tr_class).append($("<td/>").text(cidr)).append($("<td/>").text(port));
        tr.find("td").annotate(rule)
        table.append(tr);
      })        
    }
  }; // renderRules
  
  // INBOUND
  if (group.get("inbound").length > 0) {
    table.append($("<tr/>").append($("<th colspan='2'/>").css("background-color", "#001144").css("color", "#ffffff").css("font", "10px tahoma").text("INBOUND")));    
    _.each(group.get("inbound"), function(rule) {
      renderRule(rule, "in");
    });
    
  }
  
  // OUTBOUND
  if (group.get("outbound").length > 0) {
    table.append($("<tr/>").append($("<th colspan='2'/>").css("background-color", "#001144").css("color", "#ffffff").css("font", "10px tahoma").text("OUTBOUND")));    
    _.each(group.get("outbound"), function(rule) {
      renderRule(rule, "out");
    });
  }
  
  // Cancel-out add/remove rules that refer to the same params
  table.find("td.added").parent().each(function() {
    var row_add = $(this);
    var row_add_text = $(this).text();
    var matches = table.find("td.deleted").parent().filter(function() {
      return $(this).attr("class") == row_add.attr("class") && $(this).text() == row_add_text;
    });
    if (matches.size() > 0) {
      row_add.remove();
      matches.remove();
    }
  })
  
  table.data("removeTooltip", function() {
    if (table.data("activeTooltip")) {
      if (table.data("activeTooltipTable")) {
        table.data("activeTooltipTable").data("removeTooltip")();
        table.data("activeTooltipTable", null);
      } 
      table.data("activeTooltip").tooltip("hide");
      table.data("activeTooltip", null);
    }
  })
  
  table.css("max-width", "200px");
  
  return table.wrap("<div/>").parent().click(function(event) {
    event.stopPropagation();  // So that tooltip won't disappear if you click on it
  });

}

function populateSecurityGroups(vpc_id) {

  var instanceRows = $("#public_instances tbody tr, #private_instances tbody tr");

  var secgroup_list = $("#secgroup_list");
  secgroup_list.children().filter(":not(.nav-header)").remove();
  var linktoInstances = function(secgroup_id) {
    $("#public_instances tbody, #private_instances tbody").children().each(function() {
      var inst_id = $(this).attr("inst_id");
      $(this).data("secgroups", instances.get(inst_id).get("secgroups"));
    });      
  };
  
  secgroups.each(function(group) {
  
    if (group.get("vpcId") !== vpc_id) return;
    var name = group.get("name") !== undefined ? group.get("name") : "["+group.id+"]";
    var li = $("<a href='#'/>").attr("group_id", group.id).text(name).wrap("<li/>").parent();
  
    // Style according to annotations in snapshot_diff
    if (group.get("$added")) {          // add
      li.find("a").css("background-color", "#ccffcc").css("border", "1px solid #99cc99").append("<i class='icon-plus-sign pull-right'></i>");
    } else if (group.get("$deleted")) { // delete
      li.find("a").css("background-color", "#ffcccc").css("border", "1px solid #cc9999").append("<i class='icon-minus-sign pull-right'></i>");
    } else if (group.get("$updated")) { // modify
      li.find("a").css("background-color", "#ffffcc").css("border", "1px solid #ccbb99").append("<i class='icon-edit pull-right'></i>");
    }
    if (group.get("$sgchange")) {       // secgroup changed
      li.find("a").append("<i class='icon-exclamation-sign pull-right' style='opacity:0.6;'></i>");
    }
    
    linktoInstances(group.id);
    var link = li.find("a");
        
    link.tooltip({title: function() {
      var group_id = $(this).attr("group_id");
      var subdiv = renderSecGroupTooltipTable(secgroups.get(group_id));
      link.data("activeTooltipTable", subdiv.find("table.table-tooltip"));
      return subdiv;
    }, placement: "right", trigger: "manual"});
    link.click(function(event) {
      var group_id = $(this).attr("group_id");
      event.preventDefault();
      clearTooltips();
      activeTooltip = $(this);
      activeTooltip.tooltip("show");
      return false; // So tooltip doesn't get cleared
    }).mouseover(function() {
      var group_id = $(this).attr("group_id");
      instanceRows.each(function() {
        var inst_id = $(this).attr("inst_id");
        var inst = instances.get(inst_id);
        if (inst) {
          var groups = inst.get("secgroups");
          if (groups) {
            if (groups[group_id]) {
              $(this).addClass("highlight");
            }
          }
        }
      });
    }).mouseout(function() {
      instanceRows.each(function() {
        $(this).removeClass("highlight");
      });
    });
    secgroup_list.append(li);
  });
}

function renderImageTooltipTable(image_id) {

  var table = $("<table class='table-tooltip'/>");

  table.data("removeTooltip", function() {
    if (table.data("activeTooltip")) {
      if (table.data("activeTooltipTable")) {
        table.data("activeTooltipTable").data("removeTooltip")();
        table.data("activeTooltipTable", null);
      } 
      table.data("activeTooltip").tooltip("hide");
      table.data("activeTooltip", null);
    }
  })
  
  var container = $("<div/>").click(function(event) {
    event.stopPropagation();  // So that tooltip won't disappear if you click on it
  });
  
  // Display loader while iamge details are retrieved
  var loader = $("<div/>").append($("<img src='"+baseurl+"/img/loading-small-black.gif'/>")).css("padding","10px");

  // Get image details, populate table and display  
  $.getJSON(baseurl+"/image/"+image_id, function(image) {
  
    table.append($("<tr/>").append($("<th colspan='2'/>").css("background-color", "#001144").css("color", "#ffffff").css("font", "10px tahoma").text("Image Details")));      
  
    // image id
    table.append($("<tr/>").append($("<th/>").append("ID")).append($("<td/>").text(image_id)));
    // name
    if (image.name)
      table.append($("<tr/>").append($("<th/>").append("name")).append($("<td/>").text(image.name)));
    // location
    if (image.imageLocation)
      table.append($("<tr/>").append($("<th/>").append("location")).append($("<td/>").text(image.imageLocation.replace(/\//, " / "))));
    // arch
    if (image.architecture)
      table.append($("<tr/>").append($("<th/>").append("arch")).append($("<td/>").text(image.architecture)));
    // device type
    if (image.rootDeviceType)
      table.append($("<tr/>").append($("<th/>").append("device type")).append($("<td/>").text(image.rootDeviceType)));
    // device name
    if (image.rootDeviceName)
      table.append($("<tr/>").append($("<th/>").append("device name")).append($("<td/>").text(image.rootDeviceName)));
        
    loader.hide();
    table.show();    
    
    table.closest(".tooltip").hide().show();
  });
  
  return container.append(table.hide()).append(loader);
}


function renderBlockDeviceTooltipTable(block) {

  var table = $("<table class='table-tooltip'/>");

  table.data("removeTooltip", function() {
    if (table.data("activeTooltip")) {
      if (table.data("activeTooltipTable")) {
        table.data("activeTooltipTable").data("removeTooltip")();
        table.data("activeTooltipTable", null);
      } 
      table.data("activeTooltip").tooltip("hide");
      table.data("activeTooltip", null);
    }
  })
  
  // EBS
  if (block.ebs) {
    table.append($("<tr/>").append($("<th colspan='2'/>").css("background-color", "#001144").css("color", "#ffffff").css("font", "10px tahoma").text("EBS")));      
  
    // volume id
    table.append($("<tr/>").append($("<th/>").append("volume")).append($("<td/>").text(block.ebs.volumeId)));
    // attached
    //var attach = Kalendae.moment(block.ebs.attachTime);
    //var attachtime = attach.format("M/D/YYYY HH:mm");
    table.append($("<tr/>").append($("<th/>").append("attach time")).append($("<td/>").text(block.ebs.attachTime)));
    // delete on termination
    table.append($("<tr/>").append($("<th/>").append("delete on term")).append($("<td/>").text(block.ebs.deleteOnTermination)));
    // status
    table.append($("<tr/>").append($("<th/>").append("status")).append($("<td/>").text(block.ebs.status)));
  }
  
  return table.wrap("<div/>").parent().click(function(event) {
    event.stopPropagation();  // So that tooltip won't disappear if you click on it
  });
}

function renderInstTooltipTable(inst) {

  var table = $("<table class='table-tooltip'/>");
  table.append($("<tr/>").append($("<th colspan='2'/>").append($("<span style='color:#fff f00;font:normal 10px arial;'/>").text(inst.get("name"))).append($("<span style='color:#999999;padding:6px;'/>").text("("+inst.id+")"))));    

  table.data("removeTooltip", function() {
    if (table.data("activeTooltip")) {
      if (table.data("activeTooltipTable")) {
        table.data("activeTooltipTable").data("removeTooltip")();
        table.data("activeTooltipTable", null);
      } 
      table.data("activeTooltip").tooltip("hide");
      table.data("activeTooltip", null);
    }
  })
  
  // GENERAL
  table.append($("<tr/>").append($("<th colspan='2'/>").css("background-color", "#001144").css("color", "#ffffff").css("font", "10px tahoma").text("General")));      

  // image
  var image_id = inst.get("imageId");
  var img_link = $("<a/>").text(image_id);
  img_link.tooltip({title: function() {
    var subdiv = renderImageTooltipTable(image_id);
    var subtable = subdiv.find("table.table-tooltip");
    table.data("activeTooltip", $(this));
    table.data("activeTooltipTable", subtable);       
    return subdiv; 
  }, placement: "right", trigger: "manual"});
  img_link.click(function() {
    table.data("removeTooltip")();
    $(this).tooltip("show");
  });  
  table.append($("<tr/>").append($("<th/>").append("image")).append($("<td/>").html(img_link)));
  
  // kernel
  if (inst.get("kernelId")) {
    table.append($("<tr/>").append($("<th/>").append("kernel")).append($("<td/>").text(inst.get("kernelId"))));
  }
  // instance type
  if (inst.get("instanceType")) {
    table.append($("<tr/>").append($("<th/>").append("type")).append($("<td/>").text(inst.get("instanceType"))));
  }
  // state
  var state = inst.get("instanceState");
  var state_td = $("<td/>").text(_.values(state).join(" / "));
  if (state_td && state && state.name) {
    if (state.name == 'running') {
      state_td.append("<img src='"+baseurl+"/img/green-light.png' class='pull-right' style='margin:0px;'/>");
    } else if (state.name == 'stopped') {
      state_td.append("<img src='"+baseurl+"/img/red-light.png' class='pull-right' style='margin:0px;'/>");
    }
  }  
  table.append($("<tr/>").append($("<th/>").append("state")).append(state_td));
  // monitoring
  var monitoring = inst.get("monitoring");
  var monitoring_td = $("<td/>").text(monitoring && monitoring.state).annotate(monitoring);
  table.append($("<tr/>").append($("<th/>").append("monitoring")).append(monitoring_td));
  // launched
  //var launch = Kalendae.moment(inst.get("launchTime"));
  //var launchtime = launch.format("M/D/YYYY HH:mm");
  table.append($("<tr/>").append($("<th/>").append("launched")).append($("<td/>").text(inst.get("launchTime"))));
    
  // BLOCK DEVICES
  var blockdevices = inst.get("blockdevices");
  if (_.keys(blockdevices).length > 0) {
  table.append($("<tr/>").append($("<th colspan='2'/>").css("background-color", "#001144").css("color", "#ffffff").css("font", "10px tahoma").text("Block Devices")));
    _.each(blockdevices, function(val, key) {
      var name_link = $("<a/>").text(key);
      name_link.tooltip({title: function() {
        var subdiv = renderBlockDeviceTooltipTable(val);
        var subtable = subdiv.find("table.table-tooltip");
        table.data("activeTooltip", $(this));
        table.data("activeTooltipTable", subtable);       
        return subdiv; 
      }, placement: "right", trigger: "manual"});
      name_link.click(function() {
        table.data("removeTooltip")();
        $(this).tooltip("show");
      });
      table.append($("<tr/>").append($("<td colspan='2'/>").html(name_link)).find("td").annotate(val).parent());
    });
  }
    
  // SECGROUPS
  var groups = inst.get("secgroups");
  if (_.keys(groups).length > 0) {
    table.append($("<tr/>").append($("<th colspan='2'/>").css("background-color", "#001144").css("color", "#ffffff").css("font", "10px tahoma").text("Security Groups")));
    _.each(groups, function(val, key) {
      var group = secgroups.get(key);
      var name_link;
      if (group && group.get("name")) {
        name_link = $("<a/>").text(group.get("name"));
        name_link.tooltip({title: function() {
          var subdiv = renderSecGroupTooltipTable(group);
          var subtable = subdiv.find("table.table-tooltip");
          table.data("activeTooltip", $(this));
          table.data("activeTooltipTable", subtable);       
          return subdiv; 
        }, placement: "right", trigger: "manual"});
        
        name_link.click(function() {
          table.data("removeTooltip")();
          $(this).tooltip("show");
        });
      } else { // If name not available, show group id
        name_link = $("<span/>").text(key);
      }
      table.append($("<tr/>").append($("<td colspan='2' />").html(name_link)).find("td").annotate(group.toJSON()).parent());
    });
  }
  
  // TAGS
  var tags = inst.get("tags");
  delete tags["Name"];
  if (_.keys(tags).length > 0) {
    table.append($("<tr/>").append($("<th colspan='2'/>").css("background-color", "#001144").css("color", "#ffffff").css("font", "10px tahoma").text("Tags")));      
    _.each(tags, function(val, key) {
      table.append($("<tr/>").append($("<th/>").append(key)).append($("<td/>").text(val)));
    });
  }

  return table.wrap("<div/>").parent().click(function(event) {
    event.stopPropagation();  // So that tooltip won't disappear if you click on it
  });
}

function populateInstances(vpc_id) {
  var pub_inst = $("#public_instances tbody");
  var prv_inst = $("#private_instances tbody");
  
  var saveInstanceCallback = function(field_el, value) {
    value = $.trim(value);
    var inst_id = field_el.closest("tr").attr("inst_id");
    //var inst = instances.get(inst_id);
      
    // TODO: Check instance "Name" tag first  
    //if (value == ) {
      $.get(baseurl+"/instance/info/setname/"+inst_id+"/"+encodeURI(value));
    //}
  };
  
  instances.each(function(inst) {
  
    if (inst.get("vpcId") != vpc_id) return;
    
    var name_html;
    if (inst.get("local") && inst.get("local").name !== undefined) { // Local name overrides all
      name_html = $("<span style='font:bold 12px arial;color:#009900;'/>").text(inst.get("local").name).wrap("<div/>").parent().html();
    } else if (inst.get("name")) { // Name that is assigned on EC2
      name_html = $("<div/>").append($("<span style='font-size:12px;'/>").text(inst.get("name"))).html();          
    } else if (inst.get("privateDnsName")) { // Use assigned DNS name
      name_html = $("<div/>").append($("<span style='font:italic 12px arial;color:#777;'/>").text(inst.get("privateDnsName"))).html();
    } else { // If all else fails, just show the instance ID
      name_html = $("<div/>").append($("<span style='font:bold 12px monospace;color:#777;'/>").text("["+inst.id+"]")).html();
    }
         
    var ip_html = inst.get("ipAddress") ? inst.get("privateIpAddress")+"&nbsp; <span style='color:#0000ff;'>("+inst.get("ipAddress")+")</span>" : inst.get("privateIpAddress");
    var ip_td = $("<td>").addClass("ip").html(ip_html);
    
    var name_td = $("<td>").addClass("name").html(name_html);

    if (inst.get("platform") == 'windows') {
      name_td.prepend("<img src='"+baseurl+"/img/windows-icon.gif' style='margin-right:2px;'/>");
    }
    var state = inst.get("instanceState");
    
    if (ip_td && state && state.name) {
      if (state.name == 'running') {
        ip_td.append("<img src='"+baseurl+"/img/green-light.png' class='pull-right' style='margin:4px 4px 0px 0px;'/>");
      } else if (state.name == 'stopped') {
        ip_td.append("<img src='"+baseurl+"/img/red-light.png' class='pull-right' style='margin:4px 4px 0px 0px;'/>");
      }
    }
    
    var row = $("<tr>").attr("inst_id", inst.id).append(name_td).append(ip_td);
    
    // Style according to annotations in snapshot_diff
    if (inst.get("$added")) { // add
      row.css("background-color", "#ccffcc").css("border", "1px solid #99cc99").find("td").first().append("<i class='icon-plus-sign pull-right'></i>");
    } else if (inst.get("$deleted")) { // delete
      row.css("background-color", "#ffcccc").css("border", "1px solid #cc9999").find("td").first().append("<i class='icon-minus-sign pull-right'></i>");
    } else if (inst.get("$updated")) { // modify
      row.css("background-color", "#ffffcc").css("border", "1px solid #ccbb99").find("td").first().append("<i class='icon-edit pull-right'></i>");
    }
    if (inst.get("$sgchange")) { // secgroup changed
      row.find("td").first().append("<i class='icon-exclamation-sign pull-right' style='opacity:0.6;'></i>");
    }
    
    name_td.tooltip({title: function() {
      var inst_id = $(this).parent().attr("inst_id");
      var inst = instances.get(inst_id);
      var subdiv = renderInstTooltipTable(inst);
      name_td.data("activeInstTooltipTable", subdiv.find("table.table-tooltip"));
      return subdiv;
    }, placement: "bottom", trigger: "manual"});
    
    name_td.parent().click(function() {
      var inst_id = $(this).attr("inst_id");
      var inst = instances.get(inst_id);
            
      clearTooltips();
      activeInstTooltip = $(this).find("td").first();
      activeInstTooltip.tooltip("show");
      
      return false; // So tooltip doesn't get cleared
    });
    
    name_td.dblclick(function() {
      editField($(this), saveInstanceCallback);
    }).parent()
/*
    .mouseover(function() {
      _.each($(this).data("secgroups"), function(group, id) {
        var elem = $("[group_id="+id+"]");
        elem.addClass("highlight");
      });
    }).mouseout(function() {
      _.each($(this).data("secgroups"), function(group, id) {
        var elem = $("[group_id="+id+"]");
        elem.removeClass("highlight");
      });
    });
*/
    
    // Ownership of a public IP address determines which subnet it belongs to
    if (inst.get("ipAddress") !== undefined) {
      pub_inst.append(row);
    } else {
      prv_inst.append(row);
    }
    
  });    
}  

function editField(field_el, saveCallback) {
  var input = $("<input type='text' style='width:120px;'/>");
  input.val(field_el.text());
  input.data("oldval", field_el.text());
  field_el.text("").append(input);
  input.select().focus();
  input.blur(function() {
    var value = input.val();
    field_el.text(value);
    saveCallback(field_el, value);
  });    
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

