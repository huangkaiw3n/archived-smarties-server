var _ = require('lodash');
var moment = require('moment');

module.exports = {
  toProperCase: (string) => {
      return string.replace(/\w\S*/g, function(txt){return txt.charAt(0).toUpperCase() + txt.substr(1).toLowerCase();});
  },
  writeToFile: (filename, content) => {
    fs.writeFile(filename, content, (err) => {
      if (err) throw err;
      console.log("File " + filename + " written successfully. \n")
    });
  },
  calculateParkingSession: (startTimestamp, duration, rate_codes) => {
    // Current algo does not take into account there are rates with overlapping blocks
    // 1. Find current moment belongs to which rate block?
    // 2. Find minimium of current moment + duration vs current block end time.
    // 3. Take current moment to the minimium in 2 as the accountedDuration
    // 4. Calculate price based on rates for the accountedDuration
    // 5. Add price and accountedDuration to totalPrice and chargedDuration
    // 6. Repeat until either chargedDuration === duration or no rate block is found
    // Return [chargedDuration, totalPrice]

    let chargedDuration = 0;
    let totalPrice = 0; //in cents!

    // TODO THIS IS CURRENT TIME HACK! TO REMOVE
    let now = startTimestamp;
    // let now = 1485563400000;
    let startMoment = moment(now);
    let endMoment = moment(now);
    let remainingDuration = duration;
    let currentMoment = moment(now);

    while (chargedDuration < duration) {
      let currentRateDay = currentMoment.isoWeekday();
      let currentRateBlock = _(rate_codes).filter((r) => currentRateDay >= r.start_day_of_week && currentRateDay <= r.end_day_of_week)
                                          .find((r) => {
                                            let [start_hour, start_minute] = r.start_time.split(':');
                                            let [end_hour, end_minute] = r.end_time.split(':');
                                            // '[)' indicates an inclusive start and exclusive end
                                            let rateBlockStart = moment(currentMoment).set({
                                              "hour": start_hour,
                                              "minute": start_minute,
                                            });
                                            let rateBlockEnd = moment(currentMoment).set({
                                              "hour": end_hour,
                                              "minute": end_minute,
                                            });
                                            if (rateBlockEnd < rateBlockStart) { // this accounts for overnight blocks
                                              if (currentMoment.format('A') === "AM") {
                                                rateBlockStart.subtract(1, 'days');
                                              } else {
                                                rateBlockEnd.add(1, 'days');
                                              }
                                            }
                                            return currentMoment.isBetween(
                                              rateBlockStart,
                                              rateBlockEnd,
                                              null,
                                              '[)'
                                            );
                                          });
      if (!currentRateBlock) break;
      let currentRateInCentsPerMin = currentRateBlock.parking_block_duration ?
                              currentRateBlock.parking_rate * 100 / currentRateBlock.parking_block_duration : 0;
      console.log(`currentRateInCentsPerMin: ${currentRateInCentsPerMin}`);
      let accountedDuration = _.min([
                              moment(currentMoment).add(remainingDuration),
                              moment(currentMoment).set({
                                 "hour": currentRateBlock.end_time.split(':')[0],
                                 "minute": currentRateBlock.end_time.split(':')[1],
                              })
                            ]) - currentMoment;
      totalPrice = totalPrice + (Math.ceil(accountedDuration / 60000) * currentRateInCentsPerMin);
      console.log(`totalPrice: ${totalPrice}`);
      chargedDuration = chargedDuration + accountedDuration;
      console.log(`chargedDuration: ${chargedDuration}`);
      if (chargedDuration === duration) break;

      currentMoment.add(accountedDuration);
      remainingDuration = remainingDuration - accountedDuration;
    }
    return [startMoment, endMoment.add(chargedDuration), chargedDuration, totalPrice];
  }
}
