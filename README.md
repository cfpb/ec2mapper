## EC2mapper

EC2mapper is a webapp that provides a more user-friendly interface for viewing Amazon AWS network configurations, while also allowing changes to be easily tracked over time.  A daemon process periodically pulls a snapshot of all relevant information via the AWS API which is timestamped and stored into a database.  The default view will show the last snapshot retrieved -- the user can then go back in time and view the state of the network at a previous date, or select a range of days to see what was added/removed/modified within that range.

### Installation

    git clone https://github.com/cjfont/ec2mapper
    
You will need to have an instance of MongoDB running to store the snapshots.

More instructions to come...