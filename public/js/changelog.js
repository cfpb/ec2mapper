
var days_back = 20;
var vpc_info;

(function() {
  var last = Kalendae.moment();
  var first = last.clone().subtract("days",days_back);
  
  var dates = [];
  var current = last;
  while (current.diff(first)>=0) {
    dates.push(current);
    current = current.clone().subtract("days",1);
  }
  populateChangelog(dates)
})();

// ----------------------------------------------------------------------

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
  var name = selection.match(/-/) ? "Range" : "Choose a range";
  $("#date-dropdown").html(name+"&#x200A;&#x25b8;&nbsp;&nbsp;"+selection);
  var range = this.getSelectedRaw();

  var dates = [];
  var first = _.first(range);
  var last = _.last(range);
  
  var current = last;
  while (current.diff(first)>=0) {
    dates.push(current);
    current = current.clone().subtract("days",1);
  }
  
  populateChangelog(dates);
});

function populateChangelog(dates) {

  var lastdate = null;
  var container = $("#changelog");
  
  container.html("");
  
  async.auto({
    config: function(cb) {
      $.getJSON(baseurl+"/compare-config.json", function(config) {
        cb(null, config);
      });    
    },
    
    vpc_info: function(cb) {
      $.getJSON(baseurl+"/vpc/info", function(vpcinfo) {
        vpc_info = vpcinfo;
        cb(null, vpcinfo);
      });
    },
    
    dates: ['config', 'vpc_info', function(cb, res) {
      async.forEachSeries(dates, function(date, next) { 
        if (!lastdate) {
          lastdate = date;
          next();
          return;
        }
        
        var start = date.format("YYYYMMDD")+"120000";
        var end = lastdate.format("YYYYMMDD")+"120000";
        var config = res.config;
        
        async.auto({
        
          snapshot: function(cb) {
            $.getJSON(baseurl+"/snapshot/"+end, function(snap) {
              cb(null, snap);
            })
          },
          
          diff: function(cb) {
            $.getJSON(baseurl+"/diff/"+start+"/"+end, function(diff) {
              cb(null, diff);
            })
          },
          
          render: ['snapshot', 'diff', function(cb, res) {
            var block = renderJsonDiff(res.diff, config, [], res.snapshot);
            var change_count = block.data("change_count") ? block.data("change_count") : 0;        
            var section = $("<div class='section'/>").text(lastdate.format("MMM D")).append($("<span style='color:maroon;font:normal 14px arial;margin-left:16px;'/>").text(change_count?"("+change_count+" changes)":""));
            container.append(section);
            container.append(block.hide());
            section.click(function() {
              block.toggle();
            });
            lastdate = date;
            next();
          }]
        
        });
                    
      }, function(err) {
        cb();
      });
    }],
    
    finished: ['dates', function(cb) {
      // do nothing
    }]    
  });
}

function renderJsonDiff(diff, config, chain, snap) {

  var block = $("<div class='block branch'/>");
  
  var change_count = 0;
  _.each(diff, function(sec, s) {
    switch(s) {
      case 'a':
        _.each(sec, function(val,key) {
          var name = interpret(snap[key] ? snap[key] : {}, _.union(chain, [key]));
          var key_disp = $("<span style='font:bold 12px arial;color:357;' />").text(name ? name : key);
          var display = typeof val == "string" ? $("<span>").text(val) : collapseExpand(formatJson(JSON.stringify(val)));
          var elem = $("<div class='block add'><i class='icon-plus' style='opacity:0.5;'></i>&emsp;</div>").append(key_disp).append("<br>").append(display);
          block.append(elem);
          change_count++;
        });
        break;
      case 'd':
        _.each(sec, function(val,key) {
          var name = interpret(val, _.union(chain, [key]));
          var key_disp = $("<span style='font:bold 12px arial;color:357;' />").text(name ? name : key);
          var display = typeof val == "string" ? $("<span>").text(val) : collapseExpand(formatJson(JSON.stringify(val)));
          var elem = $("<div class='block delete'><i class='icon-minus' style='opacity:0.5;'></i>&emsp;</div>").append(key_disp).append("<br>").append(display);
          block.append(elem);
          change_count++;
        });
        break;
      case 'm':
        _.each(sec, function(val,key) {
          var name = interpret(snap[key] ? snap[key] : {}, _.union(chain, [key]));
          var key_disp = $("<span style='font:bold 12px arial;color:357;' />").text(name ? name : key);
          var display_before = typeof val == "string" ? $("<span>").text(val) : collapseExpand(formatJson(JSON.stringify(val[0])));
          var display_after = typeof val == "string" ? $("<span>").text(val) : collapseExpand(formatJson(JSON.stringify(val[1])));
          
          var elem;          
          if (JSON.stringify(val[0]).length > 60 || JSON.stringify(val[1]).length > 60) {
            var elem = $("<div class='block modify'><i class='icon-asterisk' style='opacity:0.3;'></i>&emsp;</div>").append(key_disp).append(":<br>").append($("<div style='border:1px dashed #999;margin:2px 1px;'>").append(collapseExpand(formatJson(JSON.stringify(val[0]))))).append("<i class='icon-arrow-right icon-white' style='opacity:0.5;margin:0px 5px;color:white;background-color:#800;'></i>").append($("<div style='border:1px dashed #999;margin:2px 1px;'>").append(collapseExpand(formatJson(JSON.stringify(val[1])))));
          } else {
            var elem = $("<div class='block modify'><i class='icon-asterisk' style='opacity:0.3;'></i>&emsp;</div>").append(key_disp).append(": "+JSON.stringify(val[0])).append("<i class='icon-arrow-right icon-white' style='opacity:0.5;margin:0px 5px;color:white;background-color:#800;'></i>").append(JSON.stringify(val[1]));
          }
          block.append(elem)
          change_count++;
        });
        break;
      case 'b':
        _.each(sec, function(val,key) {
          var name = interpret(snap[key] ? snap[key] : {}, _.union(chain, [key]));
          var key_disp = $("<span style='font:bold 12px arial;color:357;' />").text(name ? name : key);
          var newchain = _.clone(chain);
          newchain.push(key);
          var branch = renderJsonDiff(val, config[key] ? config[key] : {}, newchain, snap[key] ? snap[key] : {});
          var br_change_count = branch.data("change_count");
          var icon = $("<i class='icon-chevron-right'></i>");
          
          var title = $("<div/>").append(icon)
                .append("&nbsp;")
                .append($("<span style='font:bold 12px tahoma;color:#357;'/>").text(name ? name : key))
                .append($("<span style='margin-left:10px;font:12px arial;color:#cc0000;'/>").text("("+br_change_count+")"))
                .css("cursor","pointer");
          title.click(function() {
            $(this).next().toggle();
            $(this).find("i").toggleClass('icon-chevron-down', 'icon-chevron-right');
          })
                
          change_count += branch.data("change_count") ? branch.data("change_count") : 0;
          
          //branch.
          block.append(title);
          block.append(branch.hide());
        });
        break;
      default:
    }
  });
  
  block.data("change_count", change_count)
  return block;
};

function interpret(snap, chain) {
  // Pull name out of tagSet for instances
  snap = _.isObject(snap) ? snap : {};
  
  function chk() {
    return _.isEqual(chain.slice(-arguments.length), _.values(arguments));
  }  
  
  var retval = null;
  
  if (snap && (snap.tagSet || snap.privateIpAddress)) {
    name = _.last(chain);
    var nameTag = _.find(snap.tagSet && snap.tagSet.item ? getItems(snap.tagSet.item) : [], function(val) {
      return val.key == 'Name';
    });
    if (nameTag) {
      name = nameTag.value;
    }
    if (snap.privateIpAddress) {
      name += "/"+snap.privateIpAddress;
    }
    retval =  name;    
  } else if (chk('secgroups')) {
    retval =  "Security Groups";
  } else if (chk('instances')) {
    retval =  "Instances";
    
  } else if (snap && snap.groupName) {
    retval =  snap.groupName;
  } else if (chk('blockDeviceMapping','item') && snap.deviceName) {
    retval =  snap.deviceName; 
  } else if (chk('ipAddress')) {
    retval =  'Public IP Address';
  } else if (chk('privateIpAddress')) {
    retval =  'Private IP Address';
  } else if (chk('instanceState', 'name')) {
    retval =  'status';
  } else if (chk('reason')) {
    retval =  'state change reason';
  } else if (chk('groupSet')) {
    retval =  "Security Groups";
  } else if (chk('tagSet','item','value') && snap.key) {
    retval =  snap.key;
  }
  if (snap.vpcId && retval) {
    retval += "  ["+(vpc_info[snap.vpcId] && vpc_info[snap.vpcId].name ? vpc_info[snap.vpcId].name : snap.vpcId)+"]";
  }
  
  return retval;
}

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


// collapse with expand option
function collapseExpand(str) {

  var top = $("<div style='white-space:pre;'>");
  var bottom = $("<div style='display:none;white-space:pre;'>");
  
  var lines = str.split(/\n/);
  
  if (lines.length > 10) {
  
    topstr = lines.slice(0,5).join("\n");
    bottomstr = lines.slice(6).join("\n");
    
    top.append($("<p>").text(topstr));
    var explink = $("<a class='expand_link' href='javascript:void(0);'>").html("Show more").click(function() {
      $(this).closest("div").next().show("blind");
      $(this).hide();
    });
    top.append(explink);
    bottom.append($("<p>").text(bottomstr));
    var collink = $("<a href='javascript:void(0);'>").html("Collapse").click(function() {
      $(this).closest("div").hide("blind").prev().find("a.expand_link").show();
    });
    bottom.append(collink);
  } else {
    top.append(str);
  }
  
  return $("<div>").append(top).append(bottom);
}

// formatJson() :: formats and indents JSON string
function formatJson(val) {
	var retval = '';
	var str = val;
    var pos = 0;
    var strLen = str.length;
	var indentStr = '    ';
    var newLine = '\n';
	var char = '';
	
	for (var i=0; i<strLen; i++) {
		char = str.substring(i,i+1);
		
		if (char == '}' || char == ']') {
			retval = retval + newLine;
			pos = pos - 1;
			
			for (var j=0; j<pos; j++) {
				retval = retval + indentStr;
			}
		}
		
		retval = retval + char;	
		
		if (char == '{' || char == '[' || char == ',') {
			retval = retval + newLine;
			
			if (char == '{' || char == '[') {
				pos = pos + 1;
			}
			
			for (var k=0; k<pos; k++) {
				retval = retval + indentStr;
			}
		}
	}
	
	return retval;
}

