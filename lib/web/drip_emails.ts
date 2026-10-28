import { User } from "@prisma/client"
import { getUnsubscribeUrl } from "../../pages/unsubscribe"
import { sendEmailUnbatched } from "./notifications"

export async function sendWelcomeEmail(user: User) {
  await sendEmailUnbatched({
    subject: "Welcome to 试金石",
    htmlBody: `
    <p>Hi${user.name ? " " + user.name.split(" ")[0] : ""},</p>
    <p>Welcome to <a href="https://localhost:3000">试金石</a>: the fastest way to make and track predictions!</p>
    <p>Here are some things you could try using 试金石 for:</p>
    <ul>
      <li>Predict whether you'll complete your weekly goals in your weekly review. If the probability is low, consider ways to raise it!</li>
      <li>When your team starts a new project, forecast key assumptions and outcomes.</li>
      <li>Consider: what's the most important decision in your life right now, and how can breaking it down into concrete predictions help you make a good call?</li>
    </ul>
    <p>You can use 试金石 on <a href="https://localhost:3000">localhost:3000</a>, in <a href="https://localhost:3000/for-slack">Slack</a>, inside Google Docs or anywhere else on the web with the <a href="https://localhost:3000/extension">browser extension</a>, or via the <a href="https://localhost:3000/api">API</a>.</p>
    <p>You might also be interested in our forecasting training tools, <a href="https://quantifiedintuitions.org">Quantified Intuitions</a>.</p>
    <p>I want to make 试金石 as useful as possible, so I'd love to hear from you! What brought you here, and what would you like to get out of 试金石?</p>
    <p>Thanks,<br/>Adam</p>
    <br/>
    <p><small><i>(Note - this email is automated, but if you reply, it will go straight to my inbox! You can unsubscribe from all emails from 试金石 <a href="${getUnsubscribeUrl(
      user.email,
      false,
    )}">here</a>.)</i></small></p>
  `,
    textBody: `Hi${user.name ? ` ${user.name}` : ""},

Welcome to 试金石: the fastest way to make and track predictions.

Here are some things you could try using 试金石 for:
- Predict whether you'll complete your weekly goals in your weekly review. If the probability is low, consider ways to raise it!
- When your team starts a new project, forecast key assumptions and outcomes.
- Consider: what's the most important decision in your life right now, and how can breaking it down into concrete predictions help you make a good call?

You can use 试金石 on localhost:3000, in Slack, anywhere on the web with the browser extension, or via the API.

You might also be interested in our forecasting training tools, Quantified Intuitions.

I want to make 试金石 as useful as possible, so I'd love to hear from you! What brought you here, and what would you like to get out of 试金石?

Thanks,
Adam

(Note - this email is automated, but if you reply, it will go straight to my inbox. You can unsubscribe from all emails from 试金石 here.)`,
    to: user.email,
  })
}
