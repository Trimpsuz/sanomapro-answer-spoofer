const mockttp = require('mockttp');
const fs = require('fs');
const axios = require('axios');

function createMatchPairs(leftArray, rightArray) {
  const minLength = Math.min(leftArray.length, rightArray.length);
  const matchPairs = [];

  for (let i = 0; i < minLength; i++) {
    const leftId = leftArray[i].id;
    const rightId = rightArray[i].id;

    const matchPair = {
      leftMatchId: leftId,
      rightMatchId: rightId,
    };

    matchPairs.push(matchPair);
  }

  return matchPairs;
}

(async () => {
  if (!fs.existsSync('./ssl/key.pem') || !fs.existsSync('./ssl/cert.pem')) {
    const { key, cert } = await mockttp.generateCACertificate();
    if (!fs.existsSync('./ssl')) await fs.promises.mkdir('./ssl');

    await fs.promises.writeFile('./ssl/key.pem', key);
    await fs.promises.writeFile('./ssl/cert.pem', cert);

    console.log('PLEASE INSTALL ./ssl/cert.pem INTO YOUR BROWSER! If asked, select "Trust this CA to identify webistes" or similar.');
  }

  const version = await JSON.parse(await fs.readFileSync('package.json', 'utf-8')).version;
  const latest = (await axios.get('https://raw.githubusercontent.com/Trimpsuz/sanomapro-answer-spoofer/master/package.json')).data.version;

  if (version != latest) {
    console.log('A new version of sanomapro-answer-spoofer is available. Please run "git pull" to update.');
  }

  const server = mockttp.getLocal({
    https: {
      keyPath: './ssl/key.pem',
      certPath: './ssl/cert.pem',
    },
  });

  let ClozeCombiInteractionReq;
  let MatchSingleResponseInteractionReq;
  let MatchInteractionReq;
  server
    .forPost('/api/content/exercise/submit')
    .forHostname('kampus.sanomapro.fi')
    .thenPassThrough({
      beforeRequest: async (request) => {
        let json = await request.body.getJson();

        if (json.document.contentType == 'ClozeCombiInteraction') {
          ClozeCombiInteractionReq = request;

          //If no answers are selected, try to select them
          if (json.document.itemBody[1].interaction) {
            for (clozeContent of json.document.itemBody[1].interaction.clozeContents) {
              if (clozeContent.paragraph.clozeCombi) {
                for (const clozeCombi of clozeContent.paragraph.clozeCombi) {
                  if (clozeCombi.choices && !clozeCombi.selectedChoiceId) {
                    clozeCombi.selectedChoiceId = clozeCombi.choices[0].id;
                  }
                }
              }
            }
          }

          return {
            body: JSON.stringify(json),
          };
        } else if (json.document.contentType == 'MatchSingleResponseInteraction') {
          MatchSingleResponseInteractionReq = request;
        } else if (json.document.contentType == 'MatchInteraction') {
          MatchInteractionReq = request;
          json.document.itemBody.find((item) => item.interaction).interaction.selectedMatches = [];

          for (var i = 0; i < json.document.itemBody.find((item) => item.interaction).interaction.matchSetLeft.length; i++) {
            for (var j = 0; j < json.document.itemBody.find((item) => item.interaction).interaction.matchSetRight.length; j++) {
              json.document.itemBody
                .find((item) => item.interaction)
                .interaction.selectedMatches.push({
                  leftMatchId: await json.document.itemBody.find((item) => item.interaction).interaction.matchSetLeft[i].id,
                  rightMatchId: await json.document.itemBody.find((item) => item.interaction).interaction.matchSetRight[j].id,
                });
            }
          }

          return {
            body: JSON.stringify(json),
          };
        }
      },

      beforeResponse: async (response) => {
        let json = await response.body.getJson();

        if (json.document.contentType == 'ClozeCombiInteraction') {
          let answers = new Map([['incorrect', []]]);

          let postbody = await ClozeCombiInteractionReq.body.getJson();
          delete ClozeCombiInteractionReq.headers['content-length'];

          while (json.score != json.maxScore) {
            for (clozeContent of json.document.itemBody[1].interaction.clozeContents) {
              if (clozeContent.paragraph.clozeCombi) {
                for (const clozeCombi of clozeContent.paragraph.clozeCombi) {
                  if (clozeCombi.choices) {
                    if (clozeCombi.correct) {
                      answers.set(clozeCombi.id, { correct: clozeCombi.selectedChoiceId });
                    } else {
                      for (const choice of clozeCombi.choices) {
                        if (choice.selected && !answers.get('incorrect').includes(choice.id)) {
                          answers.get('incorrect').push(choice.id);
                        } else if (!choice.selected && (!answers.get(clozeCombi.id) || !answers.get(clozeCombi.id).untested || !answers.get(clozeCombi.id).untested.includes(choice.id))) {
                          if (!answers.get('incorrect').includes(choice.id) && (!answers.get(clozeCombi.id) || !answers.get(clozeCombi.id).untested)) {
                            answers.set(clozeCombi.id, { untested: [choice.id] });
                          } else if (!answers.get('incorrect').includes(choice.id) && answers.get(clozeCombi.id).untested.length >= clozeCombi.choices.length - 1) {
                            answers.set(clozeCombi.id, { correct: clozeCombi.selectedChoiceId });
                          } else if (!answers.get('incorrect').includes(choice.id)) {
                            answers.get(clozeCombi.id).untested.push(choice.id);
                          }
                        }
                      }
                    }
                  }
                }
              }
            }

            for (clozeContent of postbody.document.itemBody[1].interaction.clozeContents) {
              if (clozeContent.paragraph.clozeCombi) {
                for (const clozeCombi of clozeContent.paragraph.clozeCombi) {
                  if (answers.has(clozeCombi.id)) {
                    if (answers.get(clozeCombi.id).correct) {
                      clozeCombi.selectedChoiceId = answers.get(clozeCombi.id).correct;
                    } else if (answers.get(clozeCombi.id).untested) {
                      clozeCombi.selectedChoiceId = answers.get(clozeCombi.id).untested[0];
                      answers.get(clozeCombi.id).untested = answers.get(clozeCombi.id).untested.filter((e) => e !== clozeCombi.selectedChoiceId);
                    }
                  }
                }
              }
            }

            json = (await axios.post(ClozeCombiInteractionReq.url, postbody, { headers: ClozeCombiInteractionReq.headers })).data;
          }

          return {
            body: JSON.stringify(json),
          };
        } else if (json.document.contentType == 'MatchSingleResponseInteraction') {
          //If no matches are selected, try to select them
          if (!json.document.itemBody.find((item) => item.interaction).interaction.selectedMatches) {
            const matchesPost = await MatchSingleResponseInteractionReq.body.getJson();
            delete MatchSingleResponseInteractionReq.headers['content-length'];

            matchesPost.document.itemBody.find((item) => item.interaction).interaction.selectedMatches = createMatchPairs(
              json.document.itemBody.find((item) => item.interaction).interaction.matchSetLeft,
              json.document.itemBody.find((item) => item.interaction).interaction.matchSetRight
            );

            json = (await axios.post(MatchSingleResponseInteractionReq.url, matchesPost, { headers: MatchSingleResponseInteractionReq.headers })).data;
          }

          if (json.document.itemBody.find((item) => item.interaction).interaction.selectedMatches) {
            const postbody = await MatchSingleResponseInteractionReq.body.getJson();
            delete MatchSingleResponseInteractionReq.headers['content-length'];

            postbody.document.itemBody.find((item) => item.interaction).interaction.selectedMatches = createMatchPairs(
              json.document.itemBody.find((item) => item.interaction).interaction.matchSetLeft,
              json.document.itemBody.find((item) => item.interaction).interaction.matchSetRight
            );

            const res = (await axios.post(MatchSingleResponseInteractionReq.url, postbody, { headers: MatchSingleResponseInteractionReq.headers })).data;

            return {
              body: JSON.stringify(res),
            };
          }
        } else if (json.document.contentType == 'MatchInteraction') {
          const postbody = await MatchInteractionReq.body.getJson();
          delete MatchInteractionReq.headers['content-length'];

          await (postbody.document.itemBody.find((item) => item.interaction).interaction.selectedMatches = json.document.itemBody
            .find((item) => item.interaction)
            .interaction.selectedMatches.filter((obj) => obj.correct !== false));

          const res = (await axios.post(MatchInteractionReq.url, postbody, { headers: MatchInteractionReq.headers })).data;

          return {
            body: JSON.stringify(res),
          };
        }
      },
    });

  let ChoiceInteractionXopusReq;
  server
    .forPost('/api/combicontent/exercise/submit')
    .forHostname('kampus.sanomapro.fi')
    .thenPassThrough({
      beforeRequest: async (request) => {
        let json = await request.body.getJson();

        if (json.documents[0].contentType == 'ChoiceInteractionXopus') {
          ChoiceInteractionXopusReq = request;
          for (const document of json.documents) {
            for (const itemBody of document.itemBody) {
              if (itemBody.interaction) {
                for (const choice of itemBody.interaction.choices) {
                  choice.selected = true;
                }
              }
            }
          }

          return {
            body: JSON.stringify(json),
          };
        } else if (json.documents[0].contentType == 'MatchSingleResponseInteraction') {
          MatchSingleResponseInteractionReq = request;
        } else if (json.documents[0].contentType == 'ClozeCombiInteraction') {
          ClozeCombiInteractionReq = request;

          //If no answers are selected, try to select them
          for (document of json.documents) {
            if (document.itemBody[1].interaction) {
              for (clozeContent of document.itemBody[1].interaction.clozeContents) {
                if (clozeContent.paragraph.clozeCombi) {
                  for (const clozeCombi of clozeContent.paragraph.clozeCombi) {
                    if (clozeCombi.choices && !clozeCombi.selectedChoiceId) {
                      clozeCombi.selectedChoiceId = clozeCombi.choices[0].id;
                    }
                  }
                }
              }
            }
          }

          return {
            body: JSON.stringify(json),
          };
        } else if (json.documents[0].contentType == 'MatchInteraction') {
          MatchInteractionReq = request;
          json.documents[0].itemBody.find((item) => item.interaction).interaction.selectedMatches = [];

          for (var i = 0; i < json.documents[0].itemBody.find((item) => item.interaction).interaction.matchSetLeft.length; i++) {
            for (var j = 0; j < json.documents[0].itemBody.find((item) => item.interaction).interaction.matchSetRight.length; j++) {
              json.documents[0].itemBody
                .find((item) => item.interaction)
                .interaction.selectedMatches.push({
                  leftMatchId: await json.documents[0].itemBody.find((item) => item.interaction).interaction.matchSetLeft[i].id,
                  rightMatchId: await json.documents[0].itemBody.find((item) => item.interaction).interaction.matchSetRight[j].id,
                });
            }
          }

          return {
            body: JSON.stringify(json),
          };
        }
      },

      beforeResponse: async (response) => {
        let json = await response.body.getJson();

        if (json.documents[0].contentType == 'ChoiceInteractionXopus') {
          for (const document of json.documents) {
            for (const itemBody of document.itemBody) {
              if (itemBody.interaction) {
                for (const choice of itemBody.interaction.choices) {
                  if (!choice.correct) choice.selected = false;
                }
              }
            }
          }

          let postbody = await ChoiceInteractionXopusReq.body.getJson();
          delete ChoiceInteractionXopusReq.headers['content-length'];

          for (const document of postbody.documents) {
            const correspondingDocument = json.documents.find((doc) => doc.id === document.id);
            if (correspondingDocument) {
              for (const itemBody of document.itemBody) {
                if (itemBody.interaction) {
                  for (const choice of itemBody.interaction.choices) {
                    const correspondingChoice = correspondingDocument.itemBody.find((item) => item.interaction).interaction.choices.find((c) => c.id === choice.id);
                    if (correspondingChoice) {
                      choice.selected = correspondingChoice.selected;
                    }
                  }
                }
              }
            }
          }

          await axios.post(ChoiceInteractionXopusReq.url, postbody, { headers: ChoiceInteractionXopusReq.headers });

          return {
            body: JSON.stringify(json),
          };
        } else if (json.documents[0].contentType == 'MatchSingleResponseInteraction') {
          //If no matches are selected, try to select them
          if (!json.documents[0].itemBody.find((item) => item.interaction).interaction.selectedMatches) {
            const matchesPost = await MatchSingleResponseInteractionReq.body.getJson();
            delete MatchSingleResponseInteractionReq.headers['content-length'];

            matchesPost.documents[0].itemBody.find((item) => item.interaction).interaction.selectedMatches = createMatchPairs(
              json.documents[0].itemBody.find((item) => item.interaction).interaction.matchSetLeft,
              json.documents[0].itemBody.find((item) => item.interaction).interaction.matchSetRight
            );

            json = (await axios.post(MatchSingleResponseInteractionReq.url, matchesPost, { headers: MatchSingleResponseInteractionReq.headers })).data;
          }

          if (json.documents[0].itemBody.find((item) => item.interaction).interaction.selectedMatches) {
            const postbody = await MatchSingleResponseInteractionReq.body.getJson();
            delete MatchSingleResponseInteractionReq.headers['content-length'];

            postbody.documents[0].itemBody.find((item) => item.interaction).interaction.selectedMatches = createMatchPairs(
              json.documents[0].itemBody.find((item) => item.interaction).interaction.matchSetLeft,
              json.documents[0].itemBody.find((item) => item.interaction).interaction.matchSetRight
            );

            const res = (await axios.post(MatchSingleResponseInteractionReq.url, postbody, { headers: MatchSingleResponseInteractionReq.headers })).data;

            return {
              body: JSON.stringify(res),
            };
          }
        } else if (json.documents[0].contentType == 'ClozeCombiInteraction') {
          let answers = new Map([['incorrect', []]]);

          let postbody = await ClozeCombiInteractionReq.body.getJson();
          delete ClozeCombiInteractionReq.headers['content-length'];

          while (json.score != json.maxScore) {
            for (document of json.documents) {
              for (clozeContent of document.itemBody[1].interaction.clozeContents) {
                if (clozeContent.paragraph.clozeCombi) {
                  for (const clozeCombi of clozeContent.paragraph.clozeCombi) {
                    if (clozeCombi.choices) {
                      if (clozeCombi.correct) {
                        answers.set(clozeCombi.id, { correct: clozeCombi.selectedChoiceId });
                      } else {
                        for (const choice of clozeCombi.choices) {
                          if (choice.selected && !answers.get('incorrect').includes(choice.id)) {
                            answers.get('incorrect').push(choice.id);
                          } else if (!choice.selected && (!answers.get(clozeCombi.id) || !answers.get(clozeCombi.id).untested || !answers.get(clozeCombi.id).untested.includes(choice.id))) {
                            if (!answers.get('incorrect').includes(choice.id) && (!answers.get(clozeCombi.id) || !answers.get(clozeCombi.id).untested)) {
                              answers.set(clozeCombi.id, { untested: [choice.id] });
                            } else if (!answers.get('incorrect').includes(choice.id) && answers.get(clozeCombi.id).untested.length >= clozeCombi.choices.length - 1) {
                              answers.set(clozeCombi.id, { correct: clozeCombi.selectedChoiceId });
                            } else if (!answers.get('incorrect').includes(choice.id)) {
                              answers.get(clozeCombi.id).untested.push(choice.id);
                            }
                          }
                        }
                      }
                    }
                  }
                }
              }
            }

            for (document of postbody.documents) {
              for (clozeContent of document.itemBody[1].interaction.clozeContents) {
                if (clozeContent.paragraph.clozeCombi) {
                  for (const clozeCombi of clozeContent.paragraph.clozeCombi) {
                    if (answers.has(clozeCombi.id)) {
                      if (answers.get(clozeCombi.id).correct) {
                        clozeCombi.selectedChoiceId = answers.get(clozeCombi.id).correct;
                      } else if (answers.get(clozeCombi.id).untested) {
                        clozeCombi.selectedChoiceId = answers.get(clozeCombi.id).untested[0];
                        answers.get(clozeCombi.id).untested = answers.get(clozeCombi.id).untested.filter((e) => e !== clozeCombi.selectedChoiceId);
                      }
                    }
                  }
                }
              }
            }

            json = (await axios.post(ClozeCombiInteractionReq.url, postbody, { headers: ClozeCombiInteractionReq.headers })).data;
          }

          return {
            body: JSON.stringify(json),
          };
        } else if (json.documents[0].contentType == 'MatchInteraction') {
          const postbody = await MatchInteractionReq.body.getJson();
          delete MatchInteractionReq.headers['content-length'];

          await (postbody.documents[0].itemBody.find((item) => item.interaction).interaction.selectedMatches = json.documents[0].itemBody
            .find((item) => item.interaction)
            .interaction.selectedMatches.filter((obj) => obj.correct !== false));

          const res = (await axios.post(MatchInteractionReq.url, postbody, { headers: MatchInteractionReq.headers })).data;

          return {
            body: JSON.stringify(res),
          };
        }
      },
    });

  server.forUnmatchedRequest().thenPassThrough();

  await server.start(8080);

  const caFingerprint = mockttp.generateSPKIFingerprint(fs.readFileSync('./ssl/cert.pem'));
  console.log(`Server running on port ${server.port}`);
  console.log(`CA cert fingerprint ${caFingerprint}`);
})();
