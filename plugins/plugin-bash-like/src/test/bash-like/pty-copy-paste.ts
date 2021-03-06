/*
 * Copyright 2019 IBM Corporation
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 * http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */
import * as assert from 'assert'
import { readFileSync, unlink } from 'fs'
import { fileSync as tmpFile } from 'tmp'
import { promisify } from 'util'

import { Common, CLI, Keys, ReplExpect, Selectors } from '@kui-shell/test'

/** helpful selectors */
const rows = (N: number) => Selectors.xtermRows(N)
const firstRow = (N: number) => `${rows(N)} > div:first-child`
const lastRow = (N: number) => `${rows(N)} > div:last-child`

describe(`xterm copy paste ${process.env.MOCHA_RUN_TARGET || ''}`, function(this: Common.ISuite) {
  before(Common.before(this))
  after(Common.after(this))

  const emittedText = 'roadhouse'

  it(`should echo ${emittedText}`, async () => {
    try {
      const res = await CLI.command(`echo ${emittedText}`, this.app)

      // wait for the output to appear
      await this.app.client.waitForExist(rows(res.count))

      let idx = 0
      await this.app.client.waitUntil(async () => {
        const actualText = await this.app.client.getText(rows(res.count))
        if (++idx > 5) {
          console.error('still waiting for emitted text', actualText, res.count)
        }
        return actualText === emittedText
      }, CLI.waitTimeout)

      console.log('now should copy from xterm output and paste outside of xterm')

      await this.app.client.doubleClick(firstRow(res.count))
      await this.app.client.execute(() => document.execCommand('copy'))

      await this.app.client.waitForExist(Selectors.CURRENT_PROMPT_BLOCK)
      await this.app.client.click(Selectors.CURRENT_PROMPT_BLOCK)
      await this.app.client.execute(() => document.execCommand('paste'))

      await this.app.client.waitUntil(async () => {
        const [actualValue, expectedValue] = await Promise.all([
          this.app.client.getValue(Selectors.CURRENT_PROMPT),
          this.app.client.getText(rows(res.count))
        ])

        return expectedValue === actualValue
      }, CLI.waitTimeout)
    } catch (err) {
      return Common.oops(this, true)(err)
    }
  })

  it('should copy outside of xterm and paste inside of xterm', async () => {
    const text = 'hello'
    const file = tmpFile()

    try {
      // clear things out
      console.error('CP1')
      await Common.refresh(this)

      // emit some characters to the current prompt
      console.error('CP2')
      await this.app.client.keys(text)

      // wait for those characters to appear in the prompt
      console.error('CP3')
      await this.app.client.waitUntil(async () => {
        const actualText = await this.app.client.getValue(Selectors.CURRENT_PROMPT)
        return actualText === text
      }, CLI.waitTimeout)

      // copy the content of the current prompt
      console.error('CP4')
      await this.app.client.doubleClick(Selectors.CURRENT_PROMPT)
      console.error('CP5')
      await this.app.client.execute(() => document.execCommand('copy'))

      // cancel out the current prompt so we can execute vi
      console.error('CP6')
      await this.app.client.keys(Keys.ctrlC)

      // open vi, so we have an xterm to receive a paste event
      // the last true means don't try to use the copy-paste optimization
      console.error('CP7')
      const res = await CLI.command(`vim -i NONE ${file.name}`, this.app, false, true)

      // wait for vi to come up in alt buffer mode
      console.error('CP8')
      await this.app.client.waitForExist(`tab.visible.xterm-alt-buffer-mode`)

      // enter insert mode, and wait for INSERT to appear at the bottom
      console.error('CP9')
      await this.app.client.keys('i')
      console.error('CP10')
      await this.app.client.waitUntil(async () => {
        const txt = await this.app.client.getText(lastRow(res.count))
        return /INSERT/i.test(txt)
      }, CLI.waitTimeout)

      // now paste into the xterm vi
      console.error('CP11')
      await this.app.client.execute(() => document.execCommand('paste'))

      // escape then :wq
      console.error('CP12')
      await this.app.client.keys(Keys.ESCAPE)
      console.error('CP13')
      await this.app.client.waitUntil(async () => {
        const txt = await this.app.client.getText(lastRow(res.count))
        return txt.length === 0
      }, CLI.waitTimeout)

      console.error('CP14')
      await this.app.client.keys(':wq')
      console.error('CP15')
      await this.app.client.keys(Keys.ENTER)

      console.error('CP16')
      await ReplExpect.blank(res)

      console.error('CP17')
      await CLI.command(`cat ${file.name}`, this.app).then(ReplExpect.okWithStringEventually(text))

      const contents = readFileSync(file.name).toString()
      assert.strictEqual(contents.replace(/[\n\r]$/, ''), text)
      console.error('CP18')
    } catch (err) {
      return Common.oops(this, true)(err)
    } finally {
      // DO NOT return a promise here; see https://github.com/mochajs/mocha/issues/3555
      promisify(unlink)(file.name)
    }
  })
})
