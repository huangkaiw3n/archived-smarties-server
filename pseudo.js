startParking(plate, location, duration, paymentToken) {
  let logId = log(arguments)

  // Setup
  let startTime = Date.now()
  let endTime = startTime + duration
  let cost = calculateCost(location, startTime, endTime)
  let sessionId = uuid()

  // Prepare
  try
    let charge = createCharge(cost, paymentToken)
  catch error
    return error

  // Write
  try
    database.write({
      sessionId: sessionId,
      version: 0,
      location: location,
      startTime: startTime,
      endTime: endTime,
      commitments: [charge],
      cause: logId
    })
  catch error
    for commitment in commitments
      undo(commitment)
    return error

  // Commit
  for commitment in commitments
    commit(commitment)

  return sign(session)
}




extendParking(sessionToken, duration, paymentToken) {
  let logId = log(arugments)

  // Setup
  let session = database.read(sessionToken)
  let location = session.location
  let startTime = session.startTime
  let endTime = session.endTime + duration
  let totalCost = calculateCost(location, startTime, endTime)
  let additionalCost = totalCost - session.commitments.charge.amount

  // Prepare
  try
    let charge = createCharge(additionalCost, paymentToken)
  catch error
    return error

  // Write
  try
    session.version += 1
    session.endTime = endTime
    session.commitments = [charge]
    session.cause = logId
    database.writeIfNoExistingVersion(session)
  catch error
    for commitment in commitments
      undo(commitment)
    return error

  // Commit
  for commitment in commitments
    commit(commitment)

  return sign(session)
}




endParking(sessionToken) {
  let logId = log(arugments)

  // Setup
  let session = database.read(sessionToken)
  let location = session.location
  let startTime = session.startTime
  let endTime = date.now()
  let totalCost = calculateCost(location, startTime, endTime)
  let refund = session.commitments.charge.amount - totalCost

  // calculate refund strategy
  let sessions = database.find(sessionId)
  let charges = sessions.map (session) =>
    stripe.find(session.commitments.charge)
  refundMap = {}
  for charge in charges
    if refund > 0
      chargeRefund = min(charge.amount, refund)
      refundMap[charge] = chargeRefund
      refund -= chargeRefund
    else break

  // Write
  try
    session.version += 1
    session.endTime = endTime
    session.commitments = [refundMap]
    session.cause = logId
    database.writeIfNoExistingVersion(session)
  catch error
    for commitment in commitments
      undo(commitment)
    return error

  // Commit
  for commitment in commitments
    commit(commitment) // i.e do all the refunds we calculated

}
